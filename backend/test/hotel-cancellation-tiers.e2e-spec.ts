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
import { RefundCalculator } from '../src/payments';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

describe('HTL-10 hotel cancellation tiers (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let hotels: HotelsService;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const tier = (daysBeforeThreshold: number, refundPercent: number) => ({ daysBeforeThreshold, refundPercent });
  const put = (hotelId: string, cookie: string, body: unknown) =>
    http().put(`/api/hotels/${hotelId}/policies`).set('Cookie', cookie).send(body as object);
  const stored = async (hotelId: string) =>
    (await connection.collection('hotels').findOne({ _id: new Types.ObjectId(hotelId) }))?.cancellationTiers;

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
    it('the moderator sets tiers on their own hotel; the answer lists them from the largest threshold down', async () => {
      const res = await put(hotelA, modA, { cancellationTiers: [tier(0, 0), tier(14, 100), tier(7, 50)] }).expect(200);
      expect(res.body).toEqual({
        hotelId: hotelA,
        checkInTime: null,
        checkOutTime: null,
        cancellationTiers: [tier(14, 100), tier(7, 50), tier(0, 0)],
      });
      expect(await stored(hotelA)).toEqual([tier(14, 100), tier(7, 50), tier(0, 0)]);
    });

    it('replaces the whole list, and [] clears it', async () => {
      await put(hotelA, modA, { cancellationTiers: [tier(10, 80), tier(2, 20)] }).expect(200);
      expect(await stored(hotelA)).toEqual([tier(10, 80), tier(2, 20)]);
      const cleared = await put(hotelA, modA, { cancellationTiers: [] }).expect(200);
      expect(cleared.body.cancellationTiers).toEqual([]);
      expect(await stored(hotelA)).toEqual([]);
    });

    it('accepts the boundaries: threshold 0 and 365, percent 0 and 100', async () => {
      await put(hotelA, modA, { cancellationTiers: [tier(365, 100), tier(0, 0)] }).expect(200);
    });

    it('does not change the rest of the hotel', async () => {
      await put(hotelA, modA, { cancellationTiers: [tier(3, 30)] }).expect(200);
      const doc = await connection.collection('hotels').findOne({ _id: new Types.ObjectId(hotelA) });
      expect(doc).toMatchObject({ name: 'Hotel A', starRating: 4, isActive: true });
    });

    it('400 for a duplicate threshold (the field points at the repeated tier) and nothing is stored', async () => {
      await put(hotelA, modA, { cancellationTiers: [tier(9, 10)] }).expect(200);
      const res = await put(hotelA, modA, { cancellationTiers: [tier(7, 50), tier(14, 100), tier(7, 25)] }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', message: 'Validation failed', path: `/api/hotels/${hotelA}/policies` });
      expect(res.body.details).toEqual([expect.objectContaining({ field: 'cancellationTiers.2.daysBeforeThreshold' })]);
      expect(await stored(hotelA)).toEqual([tier(9, 10)]);
    });

    it.each([
      ['a negative threshold', [tier(-1, 50)]],
      ['a threshold over 365', [tier(366, 50)]],
      ['a fractional threshold', [tier(1.5, 50)]],
      ['a percent above 100', [tier(5, 101)]],
      ['a negative percent', [tier(5, -1)]],
      ['a fractional percent', [tier(5, 12.5)]],
      ['a threshold sent as text', [{ daysBeforeThreshold: '7', refundPercent: 50 }]],
      ['a missing percent', [{ daysBeforeThreshold: 7 }]],
      ['a missing threshold', [{ refundPercent: 50 }]],
      ['an unknown field inside a tier', [{ ...tier(7, 50), note: 'x' }]],
      ['an item that is not an object', [7]],
      ['more than 20 tiers', Array.from({ length: 21 }, (_, i) => tier(i, 10))],
    ])('400 for %s, and the old tiers are kept', async (_name, cancellationTiers) => {
      await put(hotelA, modA, { cancellationTiers: [tier(4, 40)] }).expect(200);
      const res = await put(hotelA, modA, { cancellationTiers }).expect(400);
      expect(res.body.message).toBe('Validation failed');
      expect(await stored(hotelA)).toEqual([tier(4, 40)]);
    });

    it('400 when the list is missing, not an array, null, or the body has an unknown field', async () => {
      await put(hotelA, modA, {}).expect(400);
      await put(hotelA, modA, { cancellationTiers: 'all' }).expect(400);
      await put(hotelA, modA, { cancellationTiers: null }).expect(400);
      await put(hotelA, modA, { cancellationTiers: [], isActive: false }).expect(400);
    });

    it('403 for a user and for an admin, 401 without a login', async () => {
      const body = { cancellationTiers: [tier(1, 10)] };
      await put(hotelA, userCookie, body).expect(403);
      await put(hotelA, admin, body).expect(403);
      await http().put(`/api/hotels/${hotelA}/policies`).send(body).expect(401);
    });

    it("403 for another hotel's moderator, an unknown hotel and a malformed id; the other hotel is unchanged", async () => {
      await put(hotelB, modB, { cancellationTiers: [tier(6, 60)] }).expect(200);
      await put(hotelB, modA, { cancellationTiers: [tier(1, 1)] }).expect(403);
      await put(new Types.ObjectId().toString(), modA, { cancellationTiers: [tier(1, 1)] }).expect(403);
      await put('not-an-id', modA, { cancellationTiers: [tier(1, 1)] }).expect(403);
      expect(await stored(hotelB)).toEqual([tier(6, 60)]);
    });

    it('parallel requests leave one complete list, never a mix of two', async () => {
      const lists = Array.from({ length: 8 }, (_, i) => Array.from({ length: i + 1 }, (_, j) => tier(j + 1, (i + 1) * 10)));
      const results = await Promise.all(lists.map((cancellationTiers) => put(hotelA, modA, { cancellationTiers })));
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
      const final = (await stored(hotelA)) as Array<{ daysBeforeThreshold: number; refundPercent: number }>;
      const expected = lists.map((l) => [...l].sort((a, b) => b.daysBeforeThreshold - a.daysBeforeThreshold));
      expect(expected).toContainEqual(final);
    });
  });

  describe('HotelsService.getCancellationTiers (exported getter)', () => {
    it('returns the stored tiers, largest threshold first, ready for the shared RefundCalculator', async () => {
      await put(hotelA, modA, { cancellationTiers: [tier(0, 0), tier(7, 50), tier(14, 100)] }).expect(200);
      const tiers = await hotels.getCancellationTiers(hotelA);
      expect(tiers).toEqual([tier(14, 100), tier(7, 50), tier(0, 0)]);

      // 20000 cents: 20 days out -> 100%, 10 days out -> 50%, 3 days out -> tier 0 -> 0%.
      expect(RefundCalculator.compute({ tiers, daysBefore: 20, totalCents: 20000 })).toBe(20000);
      expect(RefundCalculator.compute({ tiers, daysBefore: 10, totalCents: 20000 })).toBe(10000);
      expect(RefundCalculator.compute({ tiers, daysBefore: 3, totalCents: 20000 })).toBe(0);
    });

    it('a hotel without tiers has an empty list (nothing refunded)', async () => {
      await put(hotelA, modA, { cancellationTiers: [] }).expect(200);
      const tiers = await hotels.getCancellationTiers(hotelA);
      expect(tiers).toEqual([]);
      expect(RefundCalculator.compute({ tiers, daysBefore: 30, totalCents: 20000 })).toBe(0);
    });

    it('a hotel created before this ticket (no field stored) also gives []', async () => {
      const old = await connection.collection('hotels').insertOne({ name: 'Old', nameKey: 'old', cityId: 'CAI', isActive: true });
      expect(await hotels.getCancellationTiers(old.insertedId.toString())).toEqual([]);
    });

    it('404 for an unknown or malformed hotel id', async () => {
      await expect(hotels.getCancellationTiers(new Types.ObjectId().toString())).rejects.toMatchObject({ status: 404 });
      await expect(hotels.getCancellationTiers('nope')).rejects.toMatchObject({ status: 404 });
    });
  });
});
