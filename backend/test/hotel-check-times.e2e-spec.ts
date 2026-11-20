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
import { HotelsModule } from '../src/hotels/hotels.module';
import { HotelsService } from '../src/hotels/hotels.service';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

describe('HTL-09 hotel check-in / check-out times (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let hotels: HotelsService;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const put = (hotelId: string, cookie: string, body: unknown) =>
    http().put(`/api/hotels/${hotelId}/policies`).set('Cookie', cookie).send(body as object);
  const stored = (hotelId: string) => connection.collection('hotels').findOne({ _id: new Types.ObjectId(hotelId) });

  const insertUser = (email: string, extra: Record<string, unknown>) =>
    connection.collection('users').insertOne({
      name: 'Seeded',
      email,
      passwordHash: hashSync(PASSWORD, 4),
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });

  const loginCookie = async (email: string): Promise<string> => {
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return ((res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('access_token=')) as string).split(';')[0];
  };

  let admin: string;
  let userCookie: string;
  let modA: string;
  let modB: string;
  let hotelA: string;
  let hotelB: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryServer.create();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        HotelsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    hotels = app.get(HotelsService);
    await connection.model('Hotel').init();
    await connection.collection('cities').insertOne({ city_id: 'CAI', name: 'Cairo', country_code: 'EG' });

    await insertUser('admin@example.com', { role: Role.ADMIN });
    admin = await loginCookie('admin@example.com');
    const hotel = (name: string) => ({ name, address: '12 Corniche El Nil', cityId: 'CAI', description: 'Riverside hotel.', starRating: 4 });
    hotelA = (await http().post('/api/hotels').set('Cookie', admin).send(hotel('Hotel A')).expect(201)).body.id;
    hotelB = (await http().post('/api/hotels').set('Cookie', admin).send(hotel('Hotel B')).expect(201)).body.id;

    await insertUser('user@example.com', { role: Role.USER });
    await insertUser('moda@example.com', { role: Role.HOTEL_MODERATOR, hotelId: new Types.ObjectId(hotelA) });
    await insertUser('modb@example.com', { role: Role.HOTEL_MODERATOR, hotelId: new Types.ObjectId(hotelB) });
    userCookie = await loginCookie('user@example.com');
    modA = await loginCookie('moda@example.com');
    modB = await loginCookie('modb@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  describe('PUT /api/hotels/:id/policies', () => {
    it('the moderator sets both times on their own hotel', async () => {
      const res = await put(hotelA, modA, { checkInTime: '14:00', checkOutTime: '11:00' }).expect(200);
      expect(res.body).toEqual({ hotelId: hotelA, checkInTime: '14:00', checkOutTime: '11:00', cancellationTiers: [] });
      expect(await stored(hotelA)).toMatchObject({ checkInTime: '14:00', checkOutTime: '11:00' });
    });

    it('either time can be sent alone; the other one keeps its value', async () => {
      await put(hotelA, modA, { checkInTime: '15:00', checkOutTime: '12:00' }).expect(200);
      expect((await put(hotelA, modA, { checkInTime: '16:30' }).expect(200)).body).toMatchObject({ checkInTime: '16:30', checkOutTime: '12:00' });
      expect((await put(hotelA, modA, { checkOutTime: '10:15' }).expect(200)).body).toMatchObject({ checkInTime: '16:30', checkOutTime: '10:15' });
    });

    it('accepts 00:00 and 23:59, trims spaces, and a check-out earlier in the day than check-in is normal', async () => {
      expect((await put(hotelA, modA, { checkInTime: '00:00', checkOutTime: '23:59' }).expect(200)).body).toMatchObject({ checkInTime: '00:00', checkOutTime: '23:59' });
      expect((await put(hotelA, modA, { checkInTime: ' 14:00 ', checkOutTime: '11:00' }).expect(200)).body).toMatchObject({ checkInTime: '14:00', checkOutTime: '11:00' });
    });

    it.each([
      ['hour 24', '24:00'],
      ['minute 60', '12:60'],
      ['a single-digit hour', '9:00'],
      ['seconds', '14:00:00'],
      ['no colon', '1400'],
      ['a 12-hour time', '2:00 PM'],
      ['a single-digit minute', '14:0'],
      ['letters', 'ab:cd'],
      ['an empty string', ''],
      ['a negative hour', '-1:00'],
      ['an ISO date-time', '2026-11-20T14:00:00.000Z'],
      ['a number', 1400],
      ['null', null],
    ])('400 for %s, and the stored times are kept', async (_name, bad) => {
      await put(hotelA, modA, { checkInTime: '14:00', checkOutTime: '11:00' }).expect(200);
      for (const field of ['checkInTime', 'checkOutTime']) {
        const res = await put(hotelA, modA, { [field]: bad }).expect(400);
        expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', message: 'Validation failed', path: `/api/hotels/${hotelA}/policies` });
        expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
      }
      expect(await stored(hotelA)).toMatchObject({ checkInTime: '14:00', checkOutTime: '11:00' });
    });

    it('a bad time sent together with a good one saves neither', async () => {
      await put(hotelA, modA, { checkInTime: '14:00', checkOutTime: '11:00' }).expect(200);
      await put(hotelA, modA, { checkInTime: '08:00', checkOutTime: '25:00' }).expect(400);
      expect(await stored(hotelA)).toMatchObject({ checkInTime: '14:00', checkOutTime: '11:00' });
    });

    it('400 for an empty body and for unknown fields', async () => {
      const empty = await put(hotelA, modA, {}).expect(400);
      expect(empty.body.details).toEqual([expect.objectContaining({ field: 'body' })]);
      await put(hotelA, modA, { checkInTime: '14:00', isActive: false }).expect(400);
      await put(hotelA, modA, { checkInTime: '14:00', hotelId: hotelB }).expect(400);
    });

    it('saving the times does not wipe the cancellation tiers (HTL-10), and saving the tiers does not wipe the times', async () => {
      const tiers = [
        { daysBeforeThreshold: 7, refundPercent: 50 },
        { daysBeforeThreshold: 0, refundPercent: 0 },
      ];
      await put(hotelA, modA, { cancellationTiers: tiers }).expect(200);
      const timesOnly = await put(hotelA, modA, { checkInTime: '13:00', checkOutTime: '10:00' }).expect(200);
      expect(timesOnly.body).toEqual({ hotelId: hotelA, checkInTime: '13:00', checkOutTime: '10:00', cancellationTiers: tiers });
      expect(await stored(hotelA)).toMatchObject({ cancellationTiers: tiers, checkInTime: '13:00', checkOutTime: '10:00' });

      const newTiers = [{ daysBeforeThreshold: 3, refundPercent: 20 }];
      const tiersOnly = await put(hotelA, modA, { cancellationTiers: newTiers }).expect(200);
      expect(tiersOnly.body).toEqual({ hotelId: hotelA, checkInTime: '13:00', checkOutTime: '10:00', cancellationTiers: newTiers });
      expect(await stored(hotelA)).toMatchObject({ cancellationTiers: newTiers, checkInTime: '13:00', checkOutTime: '10:00' });

      // Clearing the tiers is still not a way to lose the times.
      await put(hotelA, modA, { cancellationTiers: [] }).expect(200);
      expect(await stored(hotelA)).toMatchObject({ cancellationTiers: [], checkInTime: '13:00', checkOutTime: '10:00' });
    });

    it('both can be saved in one request, and a bad time next to good tiers saves neither', async () => {
      const tiers = [{ daysBeforeThreshold: 5, refundPercent: 40 }];
      const ok = await put(hotelA, modA, { checkInTime: '15:00', checkOutTime: '12:00', cancellationTiers: tiers }).expect(200);
      expect(ok.body).toEqual({ hotelId: hotelA, checkInTime: '15:00', checkOutTime: '12:00', cancellationTiers: tiers });

      await put(hotelA, modA, { checkInTime: '99:99', cancellationTiers: [{ daysBeforeThreshold: 1, refundPercent: 90 }] }).expect(400);
      await put(hotelA, modA, { checkInTime: '08:00', cancellationTiers: [{ daysBeforeThreshold: 1, refundPercent: 10 }, { daysBeforeThreshold: 1, refundPercent: 20 }] }).expect(400);
      expect(await stored(hotelA)).toMatchObject({ checkInTime: '15:00', checkOutTime: '12:00', cancellationTiers: tiers });
    });

    it('403 for a user and an admin, 401 without a login', async () => {
      await put(hotelA, userCookie, { checkInTime: '14:00' }).expect(403);
      await put(hotelA, admin, { checkInTime: '14:00' }).expect(403);
      await http().put(`/api/hotels/${hotelA}/policies`).send({ checkInTime: '14:00' }).expect(401);
    });

    it("403 for another hotel's moderator, an unknown hotel and a malformed id; the other hotel is unchanged", async () => {
      await put(hotelB, modB, { checkInTime: '12:00', checkOutTime: '09:00' }).expect(200);
      await put(hotelB, modA, { checkInTime: '23:00' }).expect(403);
      await put(new Types.ObjectId().toString(), modA, { checkInTime: '23:00' }).expect(403);
      await put('not-an-id', modA, { checkInTime: '23:00' }).expect(403);
      expect(await stored(hotelB)).toMatchObject({ checkInTime: '12:00', checkOutTime: '09:00' });
    });

    it('parallel requests for different times both apply; for the same time one complete value wins', async () => {
      await put(hotelA, modA, { checkInTime: '14:00', checkOutTime: '11:00' }).expect(200);
      const both = await Promise.all([put(hotelA, modA, { checkInTime: '15:00' }), put(hotelA, modA, { checkOutTime: '10:00' })]);
      expect(both.map((r) => r.status)).toEqual([200, 200]);
      expect(await stored(hotelA)).toMatchObject({ checkInTime: '15:00', checkOutTime: '10:00' });

      const times = ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00'];
      await Promise.all(times.map((checkInTime) => put(hotelA, modA, { checkInTime })));
      expect(times).toContain((await stored(hotelA))?.checkInTime);
    });
  });

  describe('the times in the hotel details response', () => {
    it('a new hotel has no times yet (null); after the PUT the hotel response carries them', async () => {
      const created = await http()
        .post('/api/hotels')
        .set('Cookie', admin)
        .send({ name: 'Fresh', address: '1 Main St', cityId: 'CAI', description: 'New.', starRating: 3 })
        .expect(201);
      expect(created.body).toMatchObject({ checkInTime: null, checkOutTime: null });

      await connection.collection('users').insertOne({
        name: 'Seeded',
        email: 'fresh@example.com',
        passwordHash: hashSync(PASSWORD, 4),
        role: Role.HOTEL_MODERATOR,
        hotelId: new Types.ObjectId(created.body.id),
        status: 'ACTIVE',
        consentAcceptedAt: new Date(),
        preferredCurrency: 'USD',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const fresh = await loginCookie('fresh@example.com');
      await put(created.body.id, fresh, { checkInTime: '14:00', checkOutTime: '11:00' }).expect(200);
      const edited = await http().patch(`/api/hotels/${created.body.id}`).set('Cookie', fresh).send({ description: 'Updated.' }).expect(200);
      expect(edited.body).toMatchObject({ description: 'Updated.', checkInTime: '14:00', checkOutTime: '11:00' });
    });
  });

  describe('HotelsService.getPolicies (exported getter)', () => {
    it('returns the stored times', async () => {
      await put(hotelA, modA, { checkInTime: '14:00', checkOutTime: '11:00' }).expect(200);
      await put(hotelA, modA, { cancellationTiers: [{ daysBeforeThreshold: 2, refundPercent: 25 }] }).expect(200);
      expect(await hotels.getPolicies(hotelA)).toEqual({
        hotelId: hotelA,
        checkInTime: '14:00',
        checkOutTime: '11:00',
        cancellationTiers: [{ daysBeforeThreshold: 2, refundPercent: 25 }],
      });
    });

    it('gives null for a time that was never set, also for a hotel stored before this ticket', async () => {
      const old = await connection.collection('hotels').insertOne({ name: 'Old', nameKey: 'old', cityId: 'CAI', isActive: true });
      const id = old.insertedId.toString();
      expect(await hotels.getPolicies(id)).toEqual({ hotelId: id, checkInTime: null, checkOutTime: null, cancellationTiers: [] });
    });

    it('404 for an unknown or malformed hotel id', async () => {
      await expect(hotels.getPolicies(new Types.ObjectId().toString())).rejects.toMatchObject({ status: 404 });
      await expect(hotels.getPolicies('nope')).rejects.toMatchObject({ status: 404 });
    });
  });
});
