import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
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
      // Visibility is changed by ITN-20, not by this ticket.
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({ visibility: 'PUBLIC' })
        .expect(400);
    });

    it('404 for an id that does not exist', async () => {
      await http()
        .patch('/api/itineraries/674a1b2c3d4e5f6a7b8c9d0e')
        .set('Cookie', alice)
        .send({ title: 'x' })
        .expect(404);
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

  describe('Swagger', () => {
    it('documents the three ITN-01 endpoints under the itineraries tag', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      expect(res.body.paths['/api/itineraries'].post.tags).toContain(
        'itineraries',
      );
      expect(res.body.paths['/api/itineraries/{id}'].patch).toBeDefined();
      expect(res.body.paths['/api/itineraries/{id}'].delete).toBeDefined();
    });
  });
});
