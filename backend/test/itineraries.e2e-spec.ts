import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { Role } from '../src/common';
import configuration from '../src/config/configuration';
import { ItinerariesModule } from '../src/itineraries';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

describe('itineraries (ITN-01) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const valid = {
    title: 'Two weeks in Egypt and the UAE',
    countryCodes: ['EG', 'AE'],
    startDate: '2026-12-20',
  };

  /** Inserts a user straight into MongoDB, then logs in through the real endpoint and returns the cookie header. */
  async function loginAs(email: string, extra: Record<string, unknown> = {}) {
    await connection.collection('users').insertOne({
      name: 'Seeded',
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.USER,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  async function createAs(cookie: string, body: object = valid) {
    const res = await http()
      .post('/api/itineraries')
      .set('Cookie', cookie)
      .send(body)
      .expect(201);
    return res.body as { id: string };
  }

  let alice: string;
  let bob: string;
  let admin: string;
  let airlineMod: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';

    mongo = await MongoMemoryServer.create();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        ItinerariesModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();

    await connection.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
      { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
    ]);
    await connection.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'dubai', name: 'Dubai', country_code: 'AE' },
    ]);

    await connection
      .collection('currencies')
      .insertMany([{ code: 'USD' }, { code: 'EGP' }, { code: 'AED' }]);

    alice = await loginAs('alice@example.com');
    bob = await loginAs('bob@example.com');
    admin = await loginAs('admin@example.com', { role: Role.ADMIN });
    airlineMod = await loginAs('mod@example.com', {
      role: Role.AIRLINE_MODERATOR,
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('POST /api/itineraries', () => {
    it('creates a private itinerary: 201 with a DTO (id, no _id/__v)', async () => {
      const res = await http()
        .post('/api/itineraries')
        .set('Cookie', alice)
        .send({
          ...valid,
          title: '  Egypt trip  ',
          countryCodes: [' eg ', 'ae'],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        title: 'Egypt trip',
        countryCodes: ['EG', 'AE'],
        startDate: '2026-12-20',
        visibility: 'PRIVATE',
        isHidden: false,
      });
      expect(res.body.id).toMatch(/^[0-9a-f]{24}$/);
      expect(res.body.authorId).toMatch(/^[0-9a-f]{24}$/);
      expect(res.body).not.toHaveProperty('_id');
      expect(res.body).not.toHaveProperty('__v');
    });

    it('401 without a login cookie', async () => {
      const res = await http().post('/api/itineraries').send(valid).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401 });
    });

    it('403 for an admin and for a moderator (wrong role)', async () => {
      await http()
        .post('/api/itineraries')
        .set('Cookie', admin)
        .send(valid)
        .expect(403);
      await http()
        .post('/api/itineraries')
        .set('Cookie', airlineMod)
        .send(valid)
        .expect(403);
    });

    it.each([
      ['missing title', { ...valid, title: undefined }, 'title'],
      ['empty title', { ...valid, title: '   ' }, 'title'],
      [
        'title of 101 characters',
        { ...valid, title: 'a'.repeat(101) },
        'title',
      ],
      [
        'no countryCodes',
        { ...valid, countryCodes: undefined },
        'countryCodes',
      ],
      ['empty countryCodes', { ...valid, countryCodes: [] }, 'countryCodes'],
      [
        'duplicate countries',
        { ...valid, countryCodes: ['EG', 'eg'] },
        'countryCodes',
      ],
      ['missing start date', { ...valid, startDate: undefined }, 'startDate'],
      [
        'a start date that is not a real day',
        { ...valid, startDate: '2026-02-30' },
        'startDate',
      ],
      [
        'a start date in the wrong format',
        { ...valid, startDate: '20/12/2026' },
        'startDate',
      ],
    ])('400 with a field-level error for %s', async (_name, body, field) => {
      const res = await http()
        .post('/api/itineraries')
        .set('Cookie', alice)
        .send(body)
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        path: '/api/itineraries',
      });
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    });

    it('accepts a title of exactly 100 characters', async () => {
      await http()
        .post('/api/itineraries')
        .set('Cookie', alice)
        .send({ ...valid, title: 'a'.repeat(100) })
        .expect(201);
    });

    it('400 for a country that is not in the seeded list', async () => {
      const res = await http()
        .post('/api/itineraries')
        .set('Cookie', alice)
        .send({ ...valid, countryCodes: ['EG', 'XX'] })
        .expect(400);
      expect(res.body.details).toEqual([
        { field: 'countryCodes', message: expect.stringContaining('XX') },
      ]);
    });

    it('400 when the body tries to set owner, visibility or hidden flag', async () => {
      for (const extra of [
        { authorId: '674a1b2c3d4e5f6a7b8c9d0e' },
        { visibility: 'PUBLIC' },
        { isHidden: true },
      ]) {
        await http()
          .post('/api/itineraries')
          .set('Cookie', alice)
          .send({ ...valid, ...extra })
          .expect(400);
      }
    });
  });

  describe('GET /api/itineraries (ITN-03)', () => {
    let carol: string;
    let dave: string;

    beforeAll(async () => {
      // Fresh users, so other tests' itineraries do not change the counts here.
      carol = await loginAs('carol@example.com');
      dave = await loginAs('dave@example.com');
    });

    it('lists only my itineraries, newest edit first, as a paginated envelope', async () => {
      const first = await createAs(carol, { ...valid, title: 'First' });
      await createAs(carol, { ...valid, title: 'Second' });
      await createAs(dave, { ...valid, title: 'Not Carol' });
      // Editing the first one moves it to the top.
      await http()
        .patch(`/api/itineraries/${first.id}`)
        .set('Cookie', carol)
        .send({ title: 'First, edited' })
        .expect(200);

      const res = await http()
        .get('/api/itineraries')
        .set('Cookie', carol)
        .expect(200);

      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      expect(res.body.items.map((row: { title: string }) => row.title)).toEqual(
        ['First, edited', 'Second'],
      );
      expect(res.body.items[0]).toEqual({
        id: first.id,
        title: 'First, edited',
        countryCodes: ['EG', 'AE'],
        startDate: '2026-12-20',
        dayCount: 0,
        visibility: 'PRIVATE',
        isHidden: false,
        updatedAt: expect.any(String),
      });
    });

    it('paginates with page and limit', async () => {
      const res = await http()
        .get('/api/itineraries?page=2&limit=1')
        .set('Cookie', carol)
        .expect(200);
      expect(res.body).toMatchObject({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].title).toBe('Second');
    });

    it('400 for an invalid page or limit', async () => {
      for (const query of ['page=0', 'limit=0', 'limit=abc', 'limit=1000']) {
        const res = await http()
          .get(`/api/itineraries?${query}`)
          .set('Cookie', carol)
          .expect(400);
        expect(res.body).toMatchObject({ statusCode: 400 });
      }
    });

    it('401 without a cookie, 403 for an admin or moderator', async () => {
      await http().get('/api/itineraries').expect(401);
      await http().get('/api/itineraries').set('Cookie', admin).expect(403);
      await http()
        .get('/api/itineraries')
        .set('Cookie', airlineMod)
        .expect(403);
    });
  });

  describe('GET /api/itineraries/:id (ITN-03)', () => {
    it('the owner opens it: 200 with the full details', async () => {
      const created = await createAs(alice);
      const res = await http()
        .get(`/api/itineraries/${created.id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(res.body).toEqual(created);
    });

    it("404 for someone else's itinerary or an unknown id", async () => {
      const { id } = await createAs(alice);
      await http().get(`/api/itineraries/${id}`).set('Cookie', bob).expect(404);
      await http()
        .get('/api/itineraries/674a1b2c3d4e5f6a7b8c9d0e')
        .set('Cookie', alice)
        .expect(404);
    });

    it('400 for a malformed id, 401 without a cookie, 403 for an admin', async () => {
      const { id } = await createAs(alice);
      await http()
        .get('/api/itineraries/not-an-id')
        .set('Cookie', alice)
        .expect(400);
      await http().get(`/api/itineraries/${id}`).expect(401);
      await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', admin)
        .expect(403);
    });
  });

  describe('PATCH /api/itineraries/:id', () => {
    it('the owner edits title, countries and start date: 200', async () => {
      const { id } = await createAs(alice);
      const res = await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({
          title: 'Egypt only',
          countryCodes: ['EG'],
          startDate: '2027-01-05',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        id,
        title: 'Egypt only',
        countryCodes: ['EG'],
        startDate: '2027-01-05',
        visibility: 'PRIVATE',
      });
    });

    it("404 for someone else's itinerary, which stays unchanged", async () => {
      const { id } = await createAs(alice);
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', bob)
        .send({ title: 'Hijacked' })
        .expect(404);
      const res = await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({ startDate: '2026-12-21' })
        .expect(200);
      expect(res.body.title).toBe(valid.title);
    });

    it('403 for an admin', async () => {
      const { id } = await createAs(alice);
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', admin)
        .send({ title: 'x' })
        .expect(403);
    });

    it('401 without a cookie', async () => {
      const { id } = await createAs(alice);
      await http()
        .patch(`/api/itineraries/${id}`)
        .send({ title: 'x' })
        .expect(401);
    });

    it('400 for a malformed id, an empty body, bad values or visibility', async () => {
      const { id } = await createAs(alice);
      await http()
        .patch('/api/itineraries/not-an-id')
        .set('Cookie', alice)
        .send({ title: 'x' })
        .expect(400);
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({})
        .expect(400);
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({ title: 'a'.repeat(101) })
        .expect(400);
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({ countryCodes: ['XX'] })
        .expect(400);
      const res = await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({ visibility: 'SECRET' })
        .expect(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'visibility' }),
      ]);
    });

    it('404 for an id that does not exist', async () => {
      await http()
        .patch('/api/itineraries/674a1b2c3d4e5f6a7b8c9d0e')
        .set('Cookie', alice)
        .send({ title: 'x' })
        .expect(404);
    });
  });

  describe('visibility (ITN-20)', () => {
    const setVisibility = (cookie: string, id: string, visibility: string) =>
      http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', cookie)
        .send({ visibility });

    /** Ids on the first public search page (the max page size, so every public itinerary in this file fits). */
    const publicIds = async (cookie?: string) => {
      const req = http().get('/api/itineraries/public/search?limit=50');
      if (cookie) req.set('Cookie', cookie);
      const res = await req.expect(200);
      return (res.body.items as { id: string }[]).map((row) => row.id);
    };

    it('a new itinerary is private: not in public search', async () => {
      const created = await createAs(alice);
      expect(created).toMatchObject({ visibility: 'PRIVATE' });
      expect(await publicIds(bob)).not.toContain(created.id);
    });

    it('the owner sets it PUBLIC: it appears in public search, for users and guests', async () => {
      const { id } = await createAs(alice);
      const shared = await setVisibility(alice, id, 'PUBLIC').expect(200);
      expect(shared.body).toMatchObject({ id, visibility: 'PUBLIC' });

      expect(await publicIds(bob)).toContain(id);
      expect(await publicIds()).toContain(id);
    });

    it('public search rows are a paginated envelope without visibility or hidden flag, newest edit first', async () => {
      const first = await createAs(alice, { ...valid, title: 'Shared one' });
      const second = await createAs(alice, { ...valid, title: 'Shared two' });
      await setVisibility(alice, first.id, 'PUBLIC').expect(200);
      await setVisibility(alice, second.id, 'PUBLIC').expect(200);

      const res = await http()
        .get('/api/itineraries/public/search?page=1&limit=2')
        .expect(200);

      expect(res.body).toMatchObject({ page: 1, limit: 2 });
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      expect(res.body.items).toEqual([
        {
          id: second.id,
          authorId: expect.stringMatching(/^[0-9a-f]{24}$/),
          title: 'Shared two',
          countryCodes: ['EG', 'AE'],
          startDate: '2026-12-20',
          updatedAt: expect.any(String),
        },
        expect.objectContaining({ id: first.id }),
      ]);
    });

    it('400 for an invalid page or limit on public search', async () => {
      for (const query of ['page=0', 'limit=0', 'limit=1000']) {
        await http().get(`/api/itineraries/public/search?${query}`).expect(400);
      }
    });

    it('GET /api/itineraries/:id stays owner-only: another user gets 404 even for a public one', async () => {
      const { id } = await createAs(alice);
      await setVisibility(alice, id, 'PUBLIC').expect(200);
      await http().get(`/api/itineraries/${id}`).set('Cookie', bob).expect(404);
    });

    it('a public itinerary stays read-only to others: edit, visibility and delete give 404', async () => {
      const { id } = await createAs(alice);
      await setVisibility(alice, id, 'PUBLIC').expect(200);

      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', bob)
        .send({ title: 'Hijacked' })
        .expect(404);
      await setVisibility(bob, id, 'PRIVATE').expect(404);
      await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', bob)
        .expect(404);

      const res = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(res.body).toMatchObject({
        title: valid.title,
        visibility: 'PUBLIC',
      });
    });

    it('setting it PRIVATE removes it from public search on the next request', async () => {
      const { id } = await createAs(alice);
      await setVisibility(alice, id, 'PUBLIC').expect(200);
      expect(await publicIds()).toContain(id);

      await setVisibility(alice, id, 'PRIVATE').expect(200);
      expect(await publicIds()).not.toContain(id);
      await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
    });

    it('a public itinerary of a deactivated author is not in public search', async () => {
      const erin = await loginAs('erin@example.com');
      const { id } = await createAs(erin);
      await setVisibility(erin, id, 'PUBLIC').expect(200);
      await connection
        .collection('users')
        .updateOne(
          { email: 'erin@example.com' },
          { $set: { status: 'DEACTIVATED' } },
        );
      expect(await publicIds()).not.toContain(id);
    });

    it('a public itinerary hidden by an admin is not in public search', async () => {
      const { id } = await createAs(alice);
      await setVisibility(alice, id, 'PUBLIC').expect(200);
      await connection
        .collection('itineraries')
        .updateOne(
          { _id: new Types.ObjectId(id) },
          { $set: { isHidden: true } },
        );
      expect(await publicIds()).not.toContain(id);
    });

    it('400 for an unknown visibility value, 401 without a cookie, 403 for an admin', async () => {
      const { id } = await createAs(alice);
      await setVisibility(alice, id, 'public').expect(400);
      await http()
        .patch(`/api/itineraries/${id}`)
        .send({ visibility: 'PUBLIC' })
        .expect(401);
      await setVisibility(admin, id, 'PUBLIC').expect(403);
    });
  });

  describe('DELETE /api/itineraries/:id', () => {
    it('the owner deletes it: 204, then it is gone (404)', async () => {
      const { id } = await createAs(alice);
      await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(204);
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({ title: 'x' })
        .expect(404);
      await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(404);
    });

    it("404 for someone else's itinerary, which survives", async () => {
      const { id } = await createAs(alice);
      await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', bob)
        .expect(404);
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({ title: 'Still here' })
        .expect(200);
    });

    it('403 for an admin, 401 without a cookie, 400 for a malformed id', async () => {
      const { id } = await createAs(alice);
      await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', admin)
        .expect(403);
      await http().delete(`/api/itineraries/${id}`).expect(401);
      await http()
        .delete('/api/itineraries/not-an-id')
        .set('Cookie', alice)
        .expect(400);
    });
  });

  describe('days (ITN-05)', () => {
    const addDay = (cookie: string, id: string, body: object) =>
      http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', cookie)
        .send(body);
    const editDay = (cookie: string, id: string, dayId: string, body: object) =>
      http()
        .patch(`/api/itineraries/${id}/days/${dayId}`)
        .set('Cookie', cookie)
        .send(body);

    it('adds days (201): numbered 1, 2 and dated from the start date; shown on the itinerary and in the list', async () => {
      const { id } = await createAs(alice);

      const first = await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      const second = await addDay(alice, id, {
        cityId: ' dubai ',
        notes: '  Desert safari  ',
      }).expect(201);

      expect(first.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        dayNumber: 1,
        date: '2026-12-20',
        cityId: 'cairo',
        notes: '',
        activities: [],
      });
      expect(second.body).toMatchObject({
        dayNumber: 2,
        date: '2026-12-21',
        cityId: 'dubai',
        notes: 'Desert safari',
      });

      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(itinerary.body.days).toEqual([first.body, second.body]);

      const list = await http()
        .get('/api/itineraries')
        .set('Cookie', alice)
        .expect(200);
      expect(
        list.body.items.find((row: { id: string }) => row.id === id),
      ).toMatchObject({ dayCount: 2 });
    });

    it('edits a day (200): city and notes change, number and date stay', async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);

      const res = await editDay(alice, id, day.body.id, {
        cityId: 'dubai',
        notes: 'Burj Khalifa',
      }).expect(200);

      expect(res.body).toEqual({
        ...day.body,
        cityId: 'dubai',
        notes: 'Burj Khalifa',
      });
    });

    it('400 for a missing or unknown city, notes too long, or an unknown field', async () => {
      const { id } = await createAs(alice);
      for (const [body, field] of [
        [{}, 'cityId'],
        [{ cityId: '   ' }, 'cityId'],
        [{ cityId: 'atlantis' }, 'cityId'],
        [{ cityId: 'cairo', notes: 'a'.repeat(2001) }, 'notes'],
        [{ cityId: 'cairo', dayNumber: 3 }, 'dayNumber'],
        [{ cityId: 'cairo', date: '2026-12-25' }, 'date'],
      ] as const) {
        const res = await addDay(alice, id, body).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
    });

    it('400 for a null city or null notes, on add and on edit', async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      for (const [body, field] of [
        [{ cityId: 'cairo', notes: null }, 'notes'],
        [{ cityId: null }, 'cityId'],
      ] as const) {
        const res = await addDay(alice, id, body).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
      for (const [body, field] of [
        [{ notes: null }, 'notes'],
        [{ cityId: null }, 'cityId'],
      ] as const) {
        const res = await editDay(alice, id, day.body.id, body).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
    });

    it('400 for an empty edit, an unknown city or a malformed day id', async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      await editDay(alice, id, day.body.id, {}).expect(400);
      await editDay(alice, id, day.body.id, { cityId: 'atlantis' }).expect(400);
      await editDay(alice, id, 'not-an-id', { notes: 'x' }).expect(400);
    });

    it('rejects the 61st day with 400', async () => {
      const { id } = await createAs(alice);
      await connection.collection('itineraries').updateOne(
        { _id: new Types.ObjectId(id) },
        {
          $set: {
            days: Array.from({ length: 60 }, () => ({
              _id: new Types.ObjectId(),
              cityId: 'cairo',
              notes: '',
            })),
          },
        },
      );
      const res = await addDay(alice, id, { cityId: 'cairo' }).expect(400);
      expect(res.body.details).toEqual([
        { field: 'days', message: 'an itinerary has at most 60 days' },
      ]);
    });

    it("404 for someone else's itinerary or day; it stays unchanged", async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);

      await addDay(bob, id, { cityId: 'cairo' }).expect(404);
      await editDay(bob, id, day.body.id, { notes: 'Hijacked' }).expect(404);
      await editDay(alice, id, '674a1b2c3d4e5f6a7b8c9d0e', {
        notes: 'x',
      }).expect(404);

      const res = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(res.body.days).toEqual([day.body]);
    });

    it('401 without a cookie, 403 for an admin or moderator', async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      await http()
        .post(`/api/itineraries/${id}/days`)
        .send({ cityId: 'cairo' })
        .expect(401);
      await addDay(admin, id, { cityId: 'cairo' }).expect(403);
      await addDay(airlineMod, id, { cityId: 'cairo' }).expect(403);
      await editDay(admin, id, day.body.id, { notes: 'x' }).expect(403);
    });
  });

  describe('city groups on GET /api/itineraries/:id (ITN-09)', () => {
    const addDay = (cookie: string, id: string, body: object) =>
      http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', cookie)
        .send(body);
    const open = (cookie: string, id: string) =>
      http().get(`/api/itineraries/${id}`).set('Cookie', cookie).expect(200);

    it('returns an empty list of groups for an itinerary without days', async () => {
      const { id } = await createAs(alice);
      const res = await open(alice, id);
      expect(res.body.cityGroups).toEqual([]);
    });

    it('groups consecutive days in the same city: A, A, B, A is three groups', async () => {
      const { id } = await createAs(alice);
      for (const cityId of ['cairo', 'cairo', 'dubai', 'cairo']) {
        await addDay(alice, id, { cityId }).expect(201);
      }

      const res = await open(alice, id);

      expect(res.body.cityGroups).toEqual([
        {
          cityId: 'cairo',
          fromDayNumber: 1,
          toDayNumber: 2,
          dayCount: 2,
          startDate: '2026-12-20',
          endDate: '2026-12-21',
          subtotalCents: 0,
        },
        {
          cityId: 'dubai',
          fromDayNumber: 3,
          toDayNumber: 3,
          dayCount: 1,
          startDate: '2026-12-22',
          endDate: '2026-12-22',
          subtotalCents: 0,
        },
        {
          cityId: 'cairo',
          fromDayNumber: 4,
          toDayNumber: 4,
          dayCount: 1,
          startDate: '2026-12-23',
          endDate: '2026-12-23',
          subtotalCents: 0,
        },
      ]);
    });

    it('merges two groups when the day between them is edited to the same city', async () => {
      const { id } = await createAs(alice);
      await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      const middle = await addDay(alice, id, { cityId: 'dubai' }).expect(201);
      await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      expect((await open(alice, id)).body.cityGroups).toHaveLength(3);

      await http()
        .patch(`/api/itineraries/${id}/days/${middle.body.id}`)
        .set('Cookie', alice)
        .send({ cityId: 'cairo' })
        .expect(200);

      const groups = (await open(alice, id)).body.cityGroups;
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ cityId: 'cairo', dayCount: 3 });
    });

    it('is part of the create and edit responses too, and moves with the start date', async () => {
      const created = await http()
        .post('/api/itineraries')
        .set('Cookie', alice)
        .send(valid)
        .expect(201);
      expect(created.body.cityGroups).toEqual([]);

      await addDay(alice, created.body.id, { cityId: 'dubai' }).expect(201);
      const edited = await http()
        .patch(`/api/itineraries/${created.body.id}`)
        .set('Cookie', alice)
        .send({ startDate: '2027-03-01' })
        .expect(200);
      expect(edited.body.cityGroups).toEqual([
        expect.objectContaining({
          cityId: 'dubai',
          startDate: '2027-03-01',
          endDate: '2027-03-01',
        }),
      ]);
    });
  });

  describe('activities (ITN-10)', () => {
    const addDay = (cookie: string, id: string, body: object) =>
      http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', cookie)
        .send(body);
    const addActivity = (
      cookie: string,
      id: string,
      dayId: string,
      body: object,
    ) =>
      http()
        .post(`/api/itineraries/${id}/days/${dayId}/activities`)
        .set('Cookie', cookie)
        .send(body);
    const editActivity = (cookie: string, activityId: string, body: object) =>
      http()
        .patch(`/api/activities/${activityId}`)
        .set('Cookie', cookie)
        .send(body);
    const removeActivity = (cookie: string, activityId: string) =>
      http().delete(`/api/activities/${activityId}`).set('Cookie', cookie);
    const withDay = async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      return { id, dayId: day.body.id as string };
    };

    it('adds an activity (201) that shows up under its day on the itinerary', async () => {
      const { id, dayId } = await withDay();

      const created = await addActivity(alice, id, dayId, {
        name: '  Pyramids of Giza  ',
        description: 'Early morning',
        time: '08:30',
        costCents: 3500,
      }).expect(201);

      expect(created.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        itineraryId: id,
        dayId,
        name: 'Pyramids of Giza',
        description: 'Early morning',
        time: '08:30',
        costCents: 3500,
        currency: expect.any(String),
      });

      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(itinerary.body.days[0].activities).toEqual([created.body]);
    });

    it('needs only a name: time and cost are optional', async () => {
      const { id, dayId } = await withDay();
      const created = await addActivity(alice, id, dayId, {
        name: 'Free walk',
      }).expect(201);
      expect(created.body).toMatchObject({
        description: '',
        time: null,
        costCents: null,
      });
    });

    it('400 for a missing, blank or too long name, a bad time, a negative, fractional or text cost, or an unknown field', async () => {
      const { id, dayId } = await withDay();
      for (const [body, field] of [
        [{}, 'name'],
        [{ name: '   ' }, 'name'],
        [{ name: 'a'.repeat(101) }, 'name'],
        [{ name: 'x', description: 'a'.repeat(2001) }, 'description'],
        [{ name: 'x', time: '25:00' }, 'time'],
        [{ name: 'x', time: '9:30' }, 'time'],
        [{ name: 'x', time: 'noon' }, 'time'],
        [{ name: 'x', costCents: -1 }, 'costCents'],
        [{ name: 'x', costCents: 12.5 }, 'costCents'],
        [{ name: 'x', costCents: '100' }, 'costCents'],
        [{ name: 'x', itineraryId: id }, 'itineraryId'],
        [{ name: 'x', ownerId: id }, 'ownerId'],
      ] as const) {
        const res = await addActivity(alice, id, dayId, body).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
    });

    it('400 for a null name or description, and for a malformed id or day id', async () => {
      const { id, dayId } = await withDay();
      for (const [body, field] of [
        [{ name: null }, 'name'],
        [{ name: 'x', description: null }, 'description'],
      ] as const) {
        const res = await addActivity(alice, id, dayId, body).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
      await addActivity(alice, id, 'not-an-id', { name: 'x' }).expect(400);
      await addActivity(alice, 'not-an-id', dayId, { name: 'x' }).expect(400);
    });

    it('edits an activity (200) and clears the time and the cost with null', async () => {
      const { id, dayId } = await withDay();
      const created = await addActivity(alice, id, dayId, {
        name: 'Museum',
        time: '10:00',
        costCents: 1500,
      }).expect(201);

      const renamed = await editActivity(alice, created.body.id, {
        name: 'Egyptian Museum',
        costCents: 1800,
      }).expect(200);
      expect(renamed.body).toEqual({
        ...created.body,
        name: 'Egyptian Museum',
        costCents: 1800,
      });

      const cleared = await editActivity(alice, created.body.id, {
        time: null,
        costCents: null,
      }).expect(200);
      expect(cleared.body).toMatchObject({ time: null, costCents: null });
    });

    it('400 for an empty edit, a null name, a bad time or cost, or a malformed activity id', async () => {
      const { id, dayId } = await withDay();
      const created = await addActivity(alice, id, dayId, {
        name: 'Museum',
      }).expect(201);
      await editActivity(alice, created.body.id, {}).expect(400);
      await editActivity(alice, created.body.id, { name: null }).expect(400);
      await editActivity(alice, created.body.id, { time: '24:00' }).expect(400);
      await editActivity(alice, created.body.id, { costCents: -5 }).expect(400);
      await editActivity(alice, 'not-an-id', { name: 'x' }).expect(400);
    });

    it('deletes an activity (204); a second delete is 404', async () => {
      const { id, dayId } = await withDay();
      const created = await addActivity(alice, id, dayId, {
        name: 'Museum',
      }).expect(201);

      await removeActivity(alice, created.body.id).expect(204);
      await removeActivity(alice, created.body.id).expect(404);

      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(itinerary.body.days[0].activities).toEqual([]);
    });

    it('404 when someone else adds, edits or deletes; the activity is unchanged; an unknown day or activity is 404 too', async () => {
      const { id, dayId } = await withDay();
      const created = await addActivity(alice, id, dayId, {
        name: 'Museum',
      }).expect(201);

      await addActivity(bob, id, dayId, { name: 'x' }).expect(404);
      await editActivity(bob, created.body.id, { name: 'Hijacked' }).expect(
        404,
      );
      await removeActivity(bob, created.body.id).expect(404);
      await addActivity(alice, id, '674a1b2c3d4e5f6a7b8c9d0e', {
        name: 'x',
      }).expect(404);
      await editActivity(alice, '674a1b2c3d4e5f6a7b8c9d0e', {
        name: 'x',
      }).expect(404);

      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(itinerary.body.days[0].activities).toEqual([created.body]);
    });

    it('401 without a cookie, 403 for an admin or moderator', async () => {
      const { id, dayId } = await withDay();
      const created = await addActivity(alice, id, dayId, {
        name: 'Museum',
      }).expect(201);

      await http()
        .post(`/api/itineraries/${id}/days/${dayId}/activities`)
        .send({ name: 'x' })
        .expect(401);
      await http()
        .patch(`/api/activities/${created.body.id}`)
        .send({ name: 'x' })
        .expect(401);
      await http().delete(`/api/activities/${created.body.id}`).expect(401);

      await addActivity(admin, id, dayId, { name: 'x' }).expect(403);
      await editActivity(admin, created.body.id, { name: 'x' }).expect(403);
      await removeActivity(airlineMod, created.body.id).expect(403);
    });

    it('deleting the itinerary deletes its activities', async () => {
      const { id, dayId } = await withDay();
      await addActivity(alice, id, dayId, { name: 'Museum' }).expect(201);

      await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(204);

      expect(
        await connection
          .collection('activities')
          .countDocuments({ itineraryId: new Types.ObjectId(id) }),
      ).toBe(0);
    });

    it('deleting a day deletes its activities and keeps the other days', async () => {
      const { id, dayId } = await withDay();
      const second = await addDay(alice, id, { cityId: 'dubai' }).expect(201);
      await addActivity(alice, id, dayId, { name: 'Museum' }).expect(201);
      await addActivity(alice, id, second.body.id, { name: 'Souk' }).expect(
        201,
      );

      await http()
        .delete(`/api/itineraries/${id}/days/${dayId}`)
        .set('Cookie', alice)
        .expect(204);

      const activities = connection.collection('activities');
      expect(
        await activities.countDocuments({
          itineraryId: new Types.ObjectId(id),
          dayId: new Types.ObjectId(dayId),
        }),
      ).toBe(0);
      expect(
        await activities.countDocuments({
          itineraryId: new Types.ObjectId(id),
          dayId: new Types.ObjectId(second.body.id),
        }),
      ).toBe(1);
    });
  });

  describe('transport costs (ITN-16)', () => {
    const addDay = (cookie: string, id: string, body: object) =>
      http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', cookie)
        .send(body);
    const add = (cookie: string, id: string, body: object) =>
      http()
        .post(`/api/itineraries/${id}/transport-costs`)
        .set('Cookie', cookie)
        .send(body);
    const edit = (cookie: string, costId: string, body: object) =>
      http()
        .patch(`/api/transport-costs/${costId}`)
        .set('Cookie', cookie)
        .send(body);
    const remove = (cookie: string, costId: string) =>
      http().delete(`/api/transport-costs/${costId}`).set('Cookie', cookie);
    const withDay = async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      const body = (dayId: string) => ({
        mode: 'FLIGHT',
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amountCents: 25000,
        currency: 'USD',
        dayId,
      });
      return { id, dayId: day.body.id as string, body };
    };

    it('adds an entry (201) that shows up on the itinerary', async () => {
      const { id, dayId, body } = await withDay();

      const created = await add(alice, id, body(dayId)).expect(201);

      expect(created.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        itineraryId: id,
        dayId,
        mode: 'FLIGHT',
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amountCents: 25000,
        currency: 'USD',
      });
      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(itinerary.body.transportCosts).toEqual([created.body]);
    });

    it('accepts an amount of 0 and a lower-case currency code, stored as upper case', async () => {
      const { id, dayId, body } = await withDay();
      const created = await add(alice, id, {
        ...body(dayId),
        amountCents: 0,
        currency: ' egp ',
      }).expect(201);
      expect(created.body).toMatchObject({ amountCents: 0, currency: 'EGP' });
    });

    it('400 for a missing field, a mode that is not allowed, a negative, fractional or text amount, an unknown currency or city, or an unknown field', async () => {
      const { id, dayId, body } = await withDay();
      const { mode, ...withoutMode } = body(dayId);
      expect(mode).toBe('FLIGHT');
      for (const [payload, field] of [
        [withoutMode, 'mode'],
        [{ ...body(dayId), mode: 'TELEPORT' }, 'mode'],
        [{ ...body(dayId), fromCityId: undefined }, 'fromCityId'],
        [{ ...body(dayId), toCityId: undefined }, 'toCityId'],
        [{ ...body(dayId), amountCents: undefined }, 'amountCents'],
        [{ ...body(dayId), amountCents: -1 }, 'amountCents'],
        [{ ...body(dayId), amountCents: 10.5 }, 'amountCents'],
        [{ ...body(dayId), amountCents: '100' }, 'amountCents'],
        [{ ...body(dayId), currency: undefined }, 'currency'],
        [{ ...body(dayId), currency: 'XXX' }, 'currency'],
        [{ ...body(dayId), fromCityId: 'atlantis' }, 'fromCityId'],
        [{ ...body(dayId), toCityId: 'atlantis' }, 'toCityId'],
        [{ ...body(dayId), dayId: undefined }, 'dayId'],
        [{ ...body(dayId), dayId: 'not-an-id' }, 'dayId'],
        [{ ...body(dayId), itineraryId: id }, 'itineraryId'],
        [{ ...body(dayId), ownerId: id }, 'ownerId'],
      ] as const) {
        const res = await add(alice, id, payload).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
    });

    it('400 for a day that belongs to another itinerary; nothing is saved', async () => {
      const { id, body } = await withDay();
      const other = await withDay();

      const res = await add(alice, id, body(other.dayId)).expect(400);

      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'dayId' }),
      ]);
      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(itinerary.body.transportCosts).toEqual([]);
    });

    it('400 for a malformed itinerary id', async () => {
      const { dayId, body } = await withDay();
      await add(alice, 'not-an-id', body(dayId)).expect(400);
    });

    it('edits an entry (200): only the sent fields change', async () => {
      const { id, dayId, body } = await withDay();
      const created = await add(alice, id, body(dayId)).expect(201);

      const edited = await edit(alice, created.body.id, {
        mode: 'TRAIN',
        amountCents: 18000,
        currency: 'EGP',
      }).expect(200);

      expect(edited.body).toEqual({
        ...created.body,
        mode: 'TRAIN',
        amountCents: 18000,
        currency: 'EGP',
      });
    });

    it('400 for an empty edit, a negative amount, an unknown currency or city, a null field or a malformed id', async () => {
      const { id, dayId, body } = await withDay();
      const created = await add(alice, id, body(dayId)).expect(201);
      await edit(alice, created.body.id, {}).expect(400);
      await edit(alice, created.body.id, { amountCents: -5 }).expect(400);
      await edit(alice, created.body.id, { currency: 'XXX' }).expect(400);
      await edit(alice, created.body.id, { toCityId: 'atlantis' }).expect(400);
      await edit(alice, created.body.id, { mode: null }).expect(400);
      await edit(alice, created.body.id, { amountCents: null }).expect(400);
      await edit(alice, 'not-an-id', { amountCents: 1 }).expect(400);
    });

    it('deletes an entry (204); a second delete is 404', async () => {
      const { id, dayId, body } = await withDay();
      const created = await add(alice, id, body(dayId)).expect(201);

      await remove(alice, created.body.id).expect(204);
      await remove(alice, created.body.id).expect(404);

      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(itinerary.body.transportCosts).toEqual([]);
    });

    it('404 when someone else adds, edits or deletes; the entry is unchanged', async () => {
      const { id, dayId, body } = await withDay();
      const created = await add(alice, id, body(dayId)).expect(201);

      await add(bob, id, body(dayId)).expect(404);
      await edit(bob, created.body.id, { amountCents: 1 }).expect(404);
      await remove(bob, created.body.id).expect(404);
      await edit(alice, '674a1b2c3d4e5f6a7b8c9d0e', { amountCents: 1 }).expect(
        404,
      );

      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(itinerary.body.transportCosts).toEqual([created.body]);
    });

    it('401 without a cookie on all three routes, 403 for an admin or moderator', async () => {
      const { id, dayId, body } = await withDay();
      const created = await add(alice, id, body(dayId)).expect(201);

      await http()
        .post(`/api/itineraries/${id}/transport-costs`)
        .send(body(dayId))
        .expect(401);
      await http()
        .patch(`/api/transport-costs/${created.body.id}`)
        .send({ amountCents: 1 })
        .expect(401);
      await http()
        .delete(`/api/transport-costs/${created.body.id}`)
        .expect(401);

      await add(admin, id, body(dayId)).expect(403);
      await edit(admin, created.body.id, { amountCents: 1 }).expect(403);
      await remove(airlineMod, created.body.id).expect(403);
    });

    it('deleting the itinerary deletes its entries', async () => {
      const { id, dayId, body } = await withDay();
      await add(alice, id, body(dayId)).expect(201);

      await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(204);

      expect(
        await connection
          .collection('transportCosts')
          .countDocuments({ itineraryId: new Types.ObjectId(id) }),
      ).toBe(0);
    });

    it('deleting a day deletes its entries and keeps the other days', async () => {
      const { id, dayId, body } = await withDay();
      const second = await addDay(alice, id, { cityId: 'dubai' }).expect(201);
      await add(alice, id, body(dayId)).expect(201);
      await add(alice, id, body(second.body.id)).expect(201);

      await http()
        .delete(`/api/itineraries/${id}/days/${dayId}`)
        .set('Cookie', alice)
        .expect(204);

      const costs = connection.collection('transportCosts');
      expect(
        await costs.countDocuments({
          itineraryId: new Types.ObjectId(id),
          dayId: new Types.ObjectId(dayId),
        }),
      ).toBe(0);
      expect(
        await costs.countDocuments({
          itineraryId: new Types.ObjectId(id),
          dayId: new Types.ObjectId(second.body.id),
        }),
      ).toBe(1);
    });
  });

  describe('PATCH /api/itineraries/:id/days/reorder (ITN-08)', () => {
    const addDay = (cookie: string, id: string, body: object) =>
      http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', cookie)
        .send(body);
    const reorder = (cookie: string, id: string, body: object) =>
      http()
        .patch(`/api/itineraries/${id}/days/reorder`)
        .set('Cookie', cookie)
        .send(body);
    const threeDays = async () => {
      const { id } = await createAs(alice);
      const a = await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      const b = await addDay(alice, id, { cityId: 'dubai' }).expect(201);
      const c = await addDay(alice, id, {
        cityId: 'cairo',
        notes: 'Back home',
      }).expect(201);
      return { id, a: a.body, b: b.body, c: c.body };
    };
    const savedOrder = async (id: string) => {
      const saved = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      return saved.body.days.map((day: { id: string }) => day.id);
    };

    it('the answer keeps the activities of every day and the transport costs, like a GET', async () => {
      const { id, a, c } = await threeDays();
      const activity = await http()
        .post(`/api/itineraries/${id}/days/${a.id}/activities`)
        .set('Cookie', alice)
        .send({ name: 'Pyramids of Giza' })
        .expect(201);
      const cost = await http()
        .post(`/api/itineraries/${id}/transport-costs`)
        .set('Cookie', alice)
        .send({
          mode: 'FLIGHT',
          fromCityId: 'cairo',
          toCityId: 'dubai',
          amountCents: 25000,
          currency: 'USD',
          dayId: a.id,
        })
        .expect(201);

      const res = await reorder(alice, id, {
        dayId: c.id,
        position: 1,
      }).expect(200);

      const moved = res.body.days.find((day: { id: string }) => day.id === a.id);
      expect(moved.activities).toEqual([activity.body]);
      expect(res.body.transportCosts).toEqual([cost.body]);
    });

    it('moves a day (200): returns the itinerary with the days renumbered and re-dated', async () => {
      const { id, a, b, c } = await threeDays();

      const res = await reorder(alice, id, {
        dayId: c.id,
        position: 1,
      }).expect(200);

      expect(
        res.body.days.map(
          (day: { id: string; dayNumber: number; date: string }) => [
            day.id,
            day.dayNumber,
            day.date,
          ],
        ),
      ).toEqual([
        [c.id, 1, '2026-12-20'],
        [a.id, 2, '2026-12-21'],
        [b.id, 3, '2026-12-22'],
      ]);
      expect(res.body.days[0]).toMatchObject({
        cityId: 'cairo',
        notes: 'Back home',
      });
      expect(await savedOrder(id)).toEqual([c.id, a.id, b.id]);
    });

    it('400 for a missing, non-integer, zero, negative or text position, a malformed day id or an unknown field', async () => {
      const { id, a } = await threeDays();
      for (const [body, field] of [
        [{ dayId: a.id }, 'position'],
        [{ dayId: a.id, position: 0 }, 'position'],
        [{ dayId: a.id, position: -1 }, 'position'],
        [{ dayId: a.id, position: 1.5 }, 'position'],
        [{ dayId: a.id, position: '2' }, 'position'],
        [{ dayId: a.id, position: null }, 'position'],
        [{ position: 1 }, 'dayId'],
        [{ dayId: 'not-an-id', position: 1 }, 'dayId'],
        [{ dayId: a.id, position: 1, dayNumber: 2 }, 'dayNumber'],
      ] as const) {
        const res = await reorder(alice, id, body).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
    });

    it('400 for a position after the last day; the order is unchanged', async () => {
      const { id, a, b, c } = await threeDays();
      const res = await reorder(alice, id, {
        dayId: a.id,
        position: 4,
      }).expect(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'position' }),
      ]);
      expect(await savedOrder(id)).toEqual([a.id, b.id, c.id]);
    });

    it('400 for a malformed itinerary id', async () => {
      await reorder(alice, 'not-an-id', {
        dayId: '674a1b2c3d4e5f6a7b8c9d0e',
        position: 1,
      }).expect(400);
    });

    it("404 for someone else's itinerary or an unknown day; the order is unchanged", async () => {
      const { id, a, b, c } = await threeDays();
      await reorder(bob, id, { dayId: a.id, position: 2 }).expect(404);
      await reorder(alice, id, {
        dayId: '674a1b2c3d4e5f6a7b8c9d0e',
        position: 2,
      }).expect(404);
      expect(await savedOrder(id)).toEqual([a.id, b.id, c.id]);
    });

    it('401 without a cookie, 403 for an admin or moderator', async () => {
      const { id, a } = await threeDays();
      await http()
        .patch(`/api/itineraries/${id}/days/reorder`)
        .send({ dayId: a.id, position: 2 })
        .expect(401);
      await reorder(admin, id, { dayId: a.id, position: 2 }).expect(403);
      await reorder(airlineMod, id, { dayId: a.id, position: 2 }).expect(403);
    });
  });

  describe('DELETE /api/itineraries/:id/days/:dayId (ITN-07)', () => {
    const addDay = (cookie: string, id: string, body: object) =>
      http()
        .post(`/api/itineraries/${id}/days`)
        .set('Cookie', cookie)
        .send(body);
    const removeDay = (cookie: string, id: string, dayId: string) =>
      http()
        .delete(`/api/itineraries/${id}/days/${dayId}`)
        .set('Cookie', cookie);

    it('deletes a day (204): the others are renumbered and re-dated, and the list shows the new count', async () => {
      const { id } = await createAs(alice);
      await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      const middle = await addDay(alice, id, { cityId: 'dubai' }).expect(201);
      const last = await addDay(alice, id, {
        cityId: 'cairo',
        notes: 'Back home',
      }).expect(201);

      await removeDay(alice, id, middle.body.id).expect(204);

      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(
        itinerary.body.days.map((day: { dayNumber: number; date: string }) => [
          day.dayNumber,
          day.date,
        ]),
      ).toEqual([
        [1, '2026-12-20'],
        [2, '2026-12-21'],
      ]);
      expect(itinerary.body.days[1]).toEqual({
        ...last.body,
        dayNumber: 2,
        date: '2026-12-21',
      });

      const list = await http()
        .get('/api/itineraries')
        .set('Cookie', alice)
        .expect(200);
      expect(
        list.body.items.find((row: { id: string }) => row.id === id),
      ).toMatchObject({ dayCount: 2 });
    });

    it('404 for a day that was already deleted, an unknown day, or a day of someone else; nothing is removed', async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);

      await removeDay(bob, id, day.body.id).expect(404);
      await removeDay(alice, id, '674a1b2c3d4e5f6a7b8c9d0e').expect(404);
      await removeDay(alice, id, day.body.id).expect(204);
      await removeDay(alice, id, day.body.id).expect(404);
    });

    it("keeps someone else's day when a stranger tries to delete it", async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      await removeDay(bob, id, day.body.id).expect(404);

      const res = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);
      expect(res.body.days).toEqual([day.body]);
    });

    it('400 for a malformed id or day id', async () => {
      const { id } = await createAs(alice);
      await removeDay(alice, id, 'not-an-id').expect(400);
      await removeDay(alice, 'not-an-id', '674a1b2c3d4e5f6a7b8c9d0e').expect(
        400,
      );
    });

    it('401 without a cookie, 403 for an admin or moderator', async () => {
      const { id } = await createAs(alice);
      const day = await addDay(alice, id, { cityId: 'cairo' }).expect(201);
      await http()
        .delete(`/api/itineraries/${id}/days/${day.body.id}`)
        .expect(401);
      await removeDay(admin, id, day.body.id).expect(403);
      await removeDay(airlineMod, id, day.body.id).expect(403);
    });
  });

  describe('Swagger', () => {
    it('documents the ITN-01, ITN-03 and ITN-05 endpoints under the itineraries tag', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      expect(res.body.paths['/api/itineraries'].post.tags).toContain(
        'itineraries',
      );
      expect(res.body.paths['/api/itineraries'].get.tags).toContain(
        'itineraries',
      );
      expect(res.body.paths['/api/itineraries/{id}'].get).toBeDefined();
      expect(res.body.paths['/api/itineraries/{id}'].patch).toBeDefined();
      expect(res.body.paths['/api/itineraries/{id}'].delete).toBeDefined();
      expect(res.body.paths['/api/itineraries/{id}/days'].post.tags).toContain(
        'itineraries',
      );
      expect(
        res.body.paths['/api/itineraries/{id}/days/{dayId}'].patch,
      ).toBeDefined();
      expect(
        res.body.paths['/api/itineraries/{id}/days/reorder'].patch,
      ).toBeDefined();
      expect(
        res.body.paths['/api/itineraries/{id}/days/{dayId}'].delete,
      ).toBeDefined();
      expect(
        res.body.paths['/api/itineraries/{id}/days/{dayId}/activities'].post
          .tags,
      ).toContain('itineraries');
      expect(res.body.paths['/api/activities/{id}'].patch).toBeDefined();
      expect(res.body.paths['/api/activities/{id}'].delete).toBeDefined();
      expect(
        res.body.paths['/api/itineraries/public/search'].get.tags,
      ).toContain('itineraries');
    });
  });
});
