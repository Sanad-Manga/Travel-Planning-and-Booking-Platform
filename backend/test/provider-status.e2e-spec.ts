import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { BSON } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AccountStatus, NotificationType, Role } from '../src/common';
import { AuditService } from '../src/audit/audit.service';
import { setupApp, setupSwagger } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(180000);

const PASSWORD = 'Acc15Fixture123';
const DAY_MS = 86_400_000;
const day = (offset: number): string =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

/**
 * ACC-15 on the REAL AppModule and a real (in-memory replica-set) MongoDB: no module is replaced except the
 * upload directory. Every login, cookie and search/booking call goes over HTTP.
 */
describe('ACC-15 suspend/reactivate moderators and deactivate/reactivate providers (real AppModule + MongoDB)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;
  let root: string;
  let adminId: string;
  let admin: string;
  const envKeys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  const http = () => request(app.getHttpServer());
  const newId = () => new Types.ObjectId();
  const oid = (value: string) => new Types.ObjectId(value);

  const insertUser = async (
    role: Role,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; email: string }> => {
    const email = `${newId().toString()}@example.test`;
    const result = await db.collection('users').insertOne({
      name: 'ACC-15 Fixture',
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role,
      status: AccountStatus.ACTIVE,
      consentAcceptedAt: new Date('2026-11-01'),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    return { id: result.insertedId.toString(), email };
  };
  const loginRaw = (email: string) =>
    http().post('/api/auth/login').send({ email, password: PASSWORD });
  const cookieOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  const loginAs = async (email: string) =>
    cookieOf(await loginRaw(email).expect(200));

  const providerPatch = (
    action: 'deactivate' | 'reactivate',
    type: string,
    id: string,
    cookie = admin,
  ) =>
    http()
      .patch(`/api/admin/providers/${type}/${id}/${action}`)
      .set('Cookie', cookie);
  const accountPatch = (
    action: 'suspend' | 'reactivate',
    id: string,
    cookie = admin,
  ) =>
    http().patch(`/api/admin/accounts/${id}/${action}`).set('Cookie', cookie);

  const hotelDoc = (id: Types.ObjectId, name: string) => ({
    _id: id,
    name,
    nameKey: `${name.toLowerCase()}-${id.toString()}`,
    address: '1 Test Street',
    cityId: 'CAI',
    countryCode: 'EG',
    description: 'Hotel.',
    photos: [],
    starRating: 4,
    amenities: [],
    cancellationTiers: [{ daysBeforeThreshold: 7, refundPercent: 50 }],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const roomDoc = (hotelId: Types.ObjectId) => ({
    _id: newId(),
    hotelId,
    name: 'Standard',
    nameKey: `standard-${hotelId.toString()}`,
    type: 'Double',
    beds: 2,
    maxOccupancy: 2,
    pricePerNightCents: 8_500,
    isActive: true,
    availability: [{ _id: newId(), startDate: day(1), endDate: day(10) }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  /** A hotel with one room and one linked HOTEL_MODERATOR. */
  const makeHotel = async (name = 'Alpha') => {
    const id = newId();
    await db.collection('hotels').insertOne(hotelDoc(id, name));
    const room = roomDoc(id);
    await db.collection('rooms').insertOne(room);
    const moderator = await insertUser(Role.HOTEL_MODERATOR, { hotelId: id });
    return { id: id.toString(), roomId: room._id.toString(), moderator };
  };
  /** An airline created through the real endpoint, with one linked AIRLINE_MODERATOR. */
  const makeAirline = async (code: string) => {
    const created = await http()
      .post('/api/airlines')
      .set('Cookie', admin)
      .send({ name: `Airline ${code}`, code })
      .expect(201);
    const moderator = await insertUser(Role.AIRLINE_MODERATOR, {
      airlineId: oid(created.body.id as string),
    });
    return { id: created.body.id as string, moderator };
  };
  /** A flight created through the real FLT-03 endpoint by the airline's moderator, with one cabin. */
  const makeFlight = async (moderatorEmail: string, flightNumber: string) => {
    const cookie = await loginAs(moderatorEmail);
    const res = await http()
      .post('/api/flights')
      .set('Cookie', cookie)
      .send({
        flightNumber,
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureLocalTime: '2090-12-01T14:30',
        arrivalLocalTime: '2090-12-01T19:45',
      })
      .expect(201);
    const flightId = res.body.id as string;
    await db.collection('cabins').insertOne({
      flightId: oid(flightId),
      cabinClass: 'ECONOMY',
      totalSeats: 50,
      bookedSeats: 0,
      heldSeats: 0,
      priceCents: 45_000,
      freeBags: 1,
      maxBagWeightKg: 23,
    });
    return flightId;
  };

  const flag = async (collection: 'hotels' | 'airlines', id: string) =>
    (await db.collection(collection).findOne({ _id: oid(id) }))!
      .isActive as boolean;
  const auditsFor = (targetId: string) =>
    db.collection('auditLogs').find({ targetId }).sort({ _id: 1 }).toArray();
  const noticesFor = (userId: string) =>
    db
      .collection('notifications')
      .find({ userId: oid(userId) })
      .sort({ _id: 1 })
      .toArray();
  const hotelSearch = () =>
    http().get(
      `/api/hotels/search?cityId=CAI&checkIn=${day(2)}&checkOut=${day(5)}&guests=2`,
    );
  const freeRooms = (hotelId: string) =>
    http().get(
      `/api/hotels/${hotelId}/rooms/available?checkIn=${day(2)}&checkOut=${day(5)}`,
    );
  const flightSearch = () =>
    http().get('/api/flights/search').query({
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureDate: '2090-12-01',
      passengers: 1,
    });
  const hotelBookingBody = (roomId: string) => ({
    checkIn: day(2),
    checkOut: day(5),
    rooms: [{ roomId, adults: 1, children: 0 }],
  });
  const names = (res: request.Response): string[] =>
    (res.body.items as Array<{ name: string }>).map((item) => item.name);

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'acc15-app-'));
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: 'acc15-application-access-0123456789abcdef',
      JWT_REFRESH_SECRET: 'acc15-application-refresh-0123456789abcdef',
      COOKIE_SECURE: 'false',
    });
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const configSpy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        configure({ ...options, ignoreEnvFile: true }),
      );
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UPLOAD_OPTIONS)
      .useValue({
        root,
        leaseMs: 60000,
        recoveryIntervalMs: 3600000,
        recoveryBatchSize: 50,
      })
      .compile();
    configSpy.mockRestore();
    app = module.createNestApplication();
    app.useLogger(false);
    setupApp(app);
    setupSwagger(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(getConnectionToken());
    await db.model('User').init();
    await db.model('Airline').init();
    await db.model('Hotel').init();

    await db.collection('countries').insertOne({
      code: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });
    await db
      .collection('cities')
      .insertOne({ city_id: 'CAI', name: 'Cairo', country_code: 'EG' });
    await db.collection('airports').insertMany([
      {
        iata_code: 'CAI',
        name: 'Cairo',
        city_id: 'CAI',
        country_code: 'EG',
        time_zone: 'Africa/Cairo',
      },
      {
        iata_code: 'JFK',
        name: 'John F. Kennedy',
        city_id: 'NYC',
        country_code: 'US',
        time_zone: 'America/New_York',
      },
    ]);
    const adminUser = await insertUser(Role.ADMIN);
    adminId = adminUser.id;
    admin = await loginAs(adminUser.email);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('admin only', () => {
    it('guest 401; USER and both moderator roles 403 on both provider routes, and nothing changes', async () => {
      const hotel = await makeHotel('Roles Hotel');
      const airline = await makeAirline('RL');
      const cookies = [
        await loginAs((await insertUser(Role.USER)).email),
        await loginAs(hotel.moderator.email),
        await loginAs(airline.moderator.email),
      ];
      for (const action of ['deactivate', 'reactivate'] as const) {
        for (const [type, id] of [
          ['hotel', hotel.id],
          ['airline', airline.id],
        ] as const) {
          await http()
            .patch(`/api/admin/providers/${type}/${id}/${action}`)
            .expect(401);
          for (const cookie of cookies)
            await providerPatch(action, type, id, cookie).expect(403);
        }
      }
      expect(await flag('hotels', hotel.id)).toBe(true);
      expect(await flag('airlines', airline.id)).toBe(true);
      expect(await auditsFor(hotel.id)).toHaveLength(0);
      expect(await noticesFor(hotel.moderator.id)).toHaveLength(0);
    });

    it('guest 401 and non-admins 403 on the account routes too', async () => {
      const target = await insertUser(Role.USER);
      const moderatorCookie = await loginAs(
        (await insertUser(Role.HOTEL_MODERATOR, { hotelId: newId() })).email,
      );
      for (const action of ['suspend', 'reactivate'] as const) {
        await http()
          .patch(`/api/admin/accounts/${target.id}/${action}`)
          .expect(401);
        await accountPatch(action, target.id, moderatorCookie).expect(403);
      }
    });
  });

  describe('input handling', () => {
    it('400 for a bad :type, a bad id and a non-empty body; 404 for an unknown provider', async () => {
      const hotel = await makeHotel('Input Hotel');
      const bad = await providerPatch('deactivate', 'flight', hotel.id).expect(
        400,
      );
      expect(bad.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        details: [{ field: 'type' }],
      });
      expect(
        (await providerPatch('deactivate', 'hotel', 'not-an-id').expect(400))
          .body.details[0].field,
      ).toBe('id');
      await providerPatch('reactivate', 'airline', '123').expect(400);
      await providerPatch('deactivate', 'hotel', hotel.id)
        .send({ isActive: false })
        .expect(400);
      expect(await flag('hotels', hotel.id)).toBe(true);
      for (const type of ['hotel', 'airline'])
        for (const action of ['deactivate', 'reactivate'] as const) {
          const res = await providerPatch(
            action,
            type,
            newId().toString(),
          ).expect(404);
          expect(res.body).toMatchObject({
            statusCode: 404,
            message: 'Provider not found',
          });
        }
      // A hotel id used with :type=airline (and vice versa) is an unknown provider, not a hit.
      await providerPatch('deactivate', 'airline', hotel.id).expect(404);
      expect(await flag('hotels', hotel.id)).toBe(true);
    });
  });

  describe.each(['hotel', 'airline'] as const)(
    '%s deactivate / reactivate',
    (type) => {
      it('flips the flag, audits both changes, notifies only the linked moderators on deactivation, and 409s a repeat', async () => {
        const first =
          type === 'hotel'
            ? await makeHotel('Notify Hotel')
            : await makeAirline('NT');
        const second =
          type === 'hotel'
            ? await makeHotel('Other Hotel')
            : await makeAirline('OT');
        const collection = type === 'hotel' ? 'hotels' : 'airlines';
        const linkField = type === 'hotel' ? 'hotelId' : 'airlineId';
        const extraRole =
          type === 'hotel' ? Role.HOTEL_MODERATOR : Role.AIRLINE_MODERATOR;
        const extra = await insertUser(extraRole, {
          [linkField]: oid(first.id),
        });
        const unrelated = await insertUser(Role.USER);

        const res = await providerPatch('deactivate', type, first.id).expect(
          200,
        );
        expect(res.body).toEqual({ id: first.id, type, isActive: false });
        expect(await flag(collection, first.id)).toBe(false);
        expect(await flag(collection, second.id)).toBe(true);

        for (const moderator of [first.moderator, extra]) {
          const notices = await noticesFor(moderator.id);
          expect(notices).toHaveLength(1);
          expect(notices[0].type).toBe(NotificationType.PROVIDER_DEACTIVATED);
        }
        expect(await noticesFor(second.moderator.id)).toHaveLength(0);
        expect(await noticesFor(unrelated.id)).toHaveLength(0);
        expect(await noticesFor(adminId)).toHaveLength(0);

        const repeat = await providerPatch('deactivate', type, first.id).expect(
          409,
        );
        expect(repeat.body.message).toBe('Provider is already deactivated');
        expect(await noticesFor(first.moderator.id)).toHaveLength(1);
        expect(await auditsFor(first.id)).toHaveLength(1);

        const back = await providerPatch('reactivate', type, first.id).expect(
          200,
        );
        expect(back.body).toEqual({ id: first.id, type, isActive: true });
        expect(await flag(collection, first.id)).toBe(true);
        // Reactivation: audit only, no notification (no such NotificationType exists).
        expect(await noticesFor(first.moderator.id)).toHaveLength(1);
        expect(
          (await providerPatch('reactivate', type, first.id).expect(409)).body
            .message,
        ).toBe('Provider is already active');

        const audits = await auditsFor(first.id);
        expect(audits).toHaveLength(2);
        expect(audits[0]).toMatchObject({
          actorId: adminId,
          action: 'PROVIDER_DEACTIVATED',
          targetType: type === 'hotel' ? 'Hotel' : 'Airline',
          targetId: first.id,
          details: {
            before: { isActive: true },
            after: { isActive: false },
            moderatorsNotified: 2,
          },
        });
        expect(audits[1]).toMatchObject({
          actorId: adminId,
          action: 'PROVIDER_REACTIVATED',
          details: { before: { isActive: false }, after: { isActive: true } },
        });
        expect(JSON.stringify(audits)).not.toMatch(/password|token|secret/i);
      });

      it('succeeds for a provider that has no moderators', async () => {
        let id: string;
        if (type === 'hotel') {
          id = newId().toString();
          await db.collection('hotels').insertOne(hotelDoc(oid(id), 'Lonely'));
        } else {
          id = (
            await http()
              .post('/api/airlines')
              .set('Cookie', admin)
              .send({ name: 'Lonely Air', code: 'LN' })
              .expect(201)
          ).body.id;
        }
        await providerPatch('deactivate', type, id).expect(200);
        expect(await auditsFor(id)).toHaveLength(1);
      });

      it('parallel deactivations change the provider exactly once (one 200, the rest 409)', async () => {
        const provider =
          type === 'hotel'
            ? await makeHotel('Race Hotel')
            : await makeAirline('RC');
        const results = await Promise.all(
          Array.from({ length: 6 }, () =>
            providerPatch('deactivate', type, provider.id),
          ),
        );
        const statuses = results.map((res) => res.status).sort();
        expect(statuses).toEqual([200, 409, 409, 409, 409, 409]);
        expect(await auditsFor(provider.id)).toHaveLength(1);
        expect(await noticesFor(provider.moderator.id)).toHaveLength(1);
        const reactivations = await Promise.all(
          Array.from({ length: 6 }, () =>
            providerPatch('reactivate', type, provider.id),
          ),
        );
        expect(reactivations.map((res) => res.status).sort()).toEqual([
          200, 409, 409, 409, 409, 409,
        ]);
        expect(await auditsFor(provider.id)).toHaveLength(2);
      });
    },
  );

  describe('deactivating a provider is separate from suspending its moderator', () => {
    it('deactivating changes no moderator: status, links and login stay as they were', async () => {
      const hotel = await makeHotel('Sep Hotel');
      const airline = await makeAirline('SP');
      for (const [type, provider, link] of [
        ['hotel', hotel, 'hotelId'],
        ['airline', airline, 'airlineId'],
      ] as const) {
        const before = await db
          .collection('users')
          .findOne({ _id: oid(provider.moderator.id) });
        await providerPatch('deactivate', type, provider.id).expect(200);
        const after = await db
          .collection('users')
          .findOne({ _id: oid(provider.moderator.id) });
        expect(after).toEqual(before);
        expect(after!.status).toBe(AccountStatus.ACTIVE);
        expect(String(after![link])).toBe(provider.id);
        await loginRaw(provider.moderator.email).expect(200);
      }
    });

    it('suspending a moderator changes no provider, which stays searchable and bookable', async () => {
      const hotel = await makeHotel('Sep Hotel 2');
      const airline = await makeAirline('S2');
      const flightId = await makeFlight(airline.moderator.email, 'SP202');
      await accountPatch('suspend', hotel.moderator.id).expect(200);
      await accountPatch('suspend', airline.moderator.id).expect(200);
      expect(await flag('hotels', hotel.id)).toBe(true);
      expect(await flag('airlines', airline.id)).toBe(true);
      const users = db.collection('users');
      expect(
        String(
          (await users.findOne({ _id: oid(hotel.moderator.id) }))!.hotelId,
        ),
      ).toBe(hotel.id);
      expect(
        String(
          (await users.findOne({ _id: oid(airline.moderator.id) }))!.airlineId,
        ),
      ).toBe(airline.id);
      expect(names(await hotelSearch().expect(200))).toContain('Sep Hotel 2');
      const flights = await flightSearch().expect(200);
      expect(
        (flights.body.items as Array<{ id: string }>).map((item) => item.id),
      ).toContain(flightId);
    });
  });

  describe('suspending and reactivating moderators', () => {
    it.each([Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
      '%s: suspend blocks real login and the old cookie at once; reactivate restores both; the link is untouched',
      async (role) => {
        const providerId = newId();
        const moderator = await insertUser(
          role,
          role === Role.HOTEL_MODERATOR
            ? { hotelId: providerId }
            : { airlineId: providerId },
        );
        const link = role === Role.HOTEL_MODERATOR ? 'hotelId' : 'airlineId';
        const oldCookie = await loginAs(moderator.email);
        await http().get('/api/auth/me').set('Cookie', oldCookie).expect(200);

        expect(
          (await accountPatch('suspend', moderator.id).expect(200)).body,
        ).toEqual({ id: moderator.id, status: AccountStatus.SUSPENDED });
        // Existing login behaviour for a suspended account: 403 "Account suspended" (not the generic 401).
        const blocked = await loginRaw(moderator.email).expect(403);
        expect(blocked.body.message).toBe('Account suspended');
        expect(blocked.headers['set-cookie']).toBeUndefined();
        await http().get('/api/auth/me').set('Cookie', oldCookie).expect(401);
        const stored = await db
          .collection('users')
          .findOne({ _id: oid(moderator.id) });
        expect(stored!.role).toBe(role);
        expect(String(stored![link])).toBe(providerId.toString());

        expect(
          (await accountPatch('reactivate', moderator.id).expect(200)).body,
        ).toEqual({ id: moderator.id, status: AccountStatus.ACTIVE });
        await http().get('/api/auth/me').set('Cookie', oldCookie).expect(200);
        const fresh = await loginAs(moderator.email);
        await http().get('/api/auth/me').set('Cookie', fresh).expect(200);

        const audits = await auditsFor(moderator.id);
        expect(audits.map((audit) => audit.action)).toEqual([
          'USER_SUSPENDED',
          'USER_REACTIVATED',
        ]);
        expect(
          (await noticesFor(moderator.id)).map((notice) => notice.type),
        ).toEqual([
          NotificationType.ACCOUNT_SUSPENDED,
          NotificationType.ACCOUNT_REACTIVATED,
        ]);
      },
    );

    it('keeps refusing ADMIN targets and self-targeting (409), and a plain USER still works', async () => {
      const otherAdmin = await insertUser(Role.ADMIN);
      for (const action of ['suspend', 'reactivate'] as const) {
        const res = await accountPatch(action, otherAdmin.id).expect(409);
        expect(res.body.message).toBe(
          'Only USER and moderator accounts can be suspended or reactivated here',
        );
        await accountPatch(action, adminId).expect(409);
      }
      expect(
        (await db.collection('users').findOne({ _id: oid(otherAdmin.id) }))!
          .status,
      ).toBe(AccountStatus.ACTIVE);
      const user = await insertUser(Role.USER);
      expect((await accountPatch('suspend', user.id).expect(200)).body).toEqual(
        { id: user.id, status: AccountStatus.SUSPENDED },
      );
      await accountPatch('reactivate', user.id).expect(200);
    });
  });

  describe('audit failure', () => {
    it('puts the flag back, sends no notification and says so (500)', async () => {
      const hotel = await makeHotel('Audit Fail Hotel');
      jest
        .spyOn(app.get(AuditService), 'log')
        .mockRejectedValueOnce(new Error('audit down'));
      const res = await providerPatch('deactivate', 'hotel', hotel.id).expect(
        500,
      );
      expect(res.body.message).toBe(
        'Provider status was not changed because audit logging failed',
      );
      expect(await flag('hotels', hotel.id)).toBe(true);
      expect(await noticesFor(hotel.moderator.id)).toHaveLength(0);
      expect(names(await hotelSearch().expect(200))).toContain(
        'Audit Fail Hotel',
      );
      await providerPatch('deactivate', 'hotel', hotel.id).expect(200);
    });
  });

  describe('existing CONFIRMED bookings stay valid', () => {
    const raw = (doc: unknown) =>
      Buffer.from(BSON.serialize(doc as BSON.Document));

    it('deactivating and reactivating the provider leaves a CONFIRMED hotel booking and a CONFIRMED flight booking byte-for-byte unchanged', async () => {
      const hotel = await makeHotel('Booked Hotel');
      const airline = await makeAirline('BK');
      const flightId = await makeFlight(airline.moderator.email, 'BK101');
      const traveler = await insertUser(Role.USER);
      const cookie = await loginAs(traveler.email);

      const hotelHold = await http()
        .post('/api/hotel-bookings')
        .set('Cookie', cookie)
        .send(hotelBookingBody(hotel.roomId))
        .expect(201);
      const flightHold = await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', cookie)
        .send({ flightId, cabinClass: 'ECONOMY', adults: 1 })
        .expect(201);
      // Test-only write: move the two real bookings to CONFIRMED (Payments' path needs Stripe).
      const confirmedAt = new Date();
      await db.collection('hotelBookings').updateOne(
        { _id: oid(hotelHold.body.id) },
        {
          $set: {
            status: 'CONFIRMED',
            paymentRef: 'pi_acc15',
            updatedAt: confirmedAt,
          },
        },
      );
      await db.collection('flightBookings').updateOne(
        { _id: oid(flightHold.body.id) },
        {
          $set: {
            status: 'CONFIRMED',
            paymentRef: 'pi_acc15',
            updatedAt: confirmedAt,
          },
        },
      );
      const snapshot = async () => ({
        hotelBooking: await db
          .collection('hotelBookings')
          .findOne({ _id: oid(hotelHold.body.id) }),
        flightBooking: await db
          .collection('flightBookings')
          .findOne({ _id: oid(flightHold.body.id) }),
      });
      const before = await snapshot();
      expect(before.hotelBooking!.status).toBe('CONFIRMED');
      expect(before.flightBooking!.status).toBe('CONFIRMED');
      const countsBefore = [
        await db.collection('hotelBookings').countDocuments(),
        await db.collection('flightBookings').countDocuments(),
      ];

      await providerPatch('deactivate', 'hotel', hotel.id).expect(200);
      await providerPatch('deactivate', 'airline', airline.id).expect(200);
      const during = await snapshot();
      expect(raw(during.hotelBooking).equals(raw(before.hotelBooking))).toBe(
        true,
      );
      expect(raw(during.flightBooking).equals(raw(before.flightBooking))).toBe(
        true,
      );

      await providerPatch('reactivate', 'hotel', hotel.id).expect(200);
      await providerPatch('reactivate', 'airline', airline.id).expect(200);
      const after = await snapshot();
      expect(raw(after.hotelBooking).equals(raw(before.hotelBooking))).toBe(
        true,
      );
      expect(raw(after.flightBooking).equals(raw(before.flightBooking))).toBe(
        true,
      );
      expect([
        await db.collection('hotelBookings').countDocuments(),
        await db.collection('flightBookings').countDocuments(),
      ]).toEqual(countsBefore);
    });
  });

  describe('hidden from search and not bookable: what develop already does, over HTTP', () => {
    it('hotel: absent from /hotels/search, /rooms/available is 404, NEW bookings are 404; reactivation restores all three', async () => {
      const hotel = await makeHotel('Visible Hotel');
      const traveler = await loginAs((await insertUser(Role.USER)).email);
      expect(names(await hotelSearch().expect(200))).toContain('Visible Hotel');
      await freeRooms(hotel.id).expect(200);

      await providerPatch('deactivate', 'hotel', hotel.id).expect(200);
      expect(names(await hotelSearch().expect(200))).not.toContain(
        'Visible Hotel',
      );
      expect((await freeRooms(hotel.id).expect(404)).body.message).toBe(
        'Hotel not found',
      );
      const before = await db.collection('hotelBookings').countDocuments();
      await http()
        .post('/api/hotel-bookings')
        .set('Cookie', traveler)
        .send(hotelBookingBody(hotel.roomId))
        .expect(404);
      expect(await db.collection('hotelBookings').countDocuments()).toBe(
        before,
      );

      await providerPatch('reactivate', 'hotel', hotel.id).expect(200);
      expect(names(await hotelSearch().expect(200))).toContain('Visible Hotel');
      await freeRooms(hotel.id).expect(200);
      await http()
        .post('/api/hotel-bookings')
        .set('Cookie', traveler)
        .send(hotelBookingBody(hotel.roomId))
        .expect(201);
    });

    it('airline: its flights are absent from /flights/search, a NEW hold is 409, flight details are hidden; reactivation restores them', async () => {
      const airline = await makeAirline('VS');
      const flightId = await makeFlight(airline.moderator.email, 'VS303');
      const traveler = await loginAs((await insertUser(Role.USER)).email);
      const ids = async () =>
        (
          (await flightSearch().expect(200)).body.items as Array<{ id: string }>
        ).map((item) => item.id);
      const hold = () =>
        http()
          .post('/api/flight-bookings/hold')
          .set('Cookie', traveler)
          .send({ flightId, cabinClass: 'ECONOMY', adults: 1 });
      expect(await ids()).toContain(flightId);

      await providerPatch('deactivate', 'airline', airline.id).expect(200);
      expect(await ids()).not.toContain(flightId);
      await http().get(`/api/flights/${flightId}`).expect(404);
      const before = await db.collection('flightBookings').countDocuments();
      await hold().expect(409);
      expect(await db.collection('flightBookings').countDocuments()).toBe(
        before,
      );

      await providerPatch('reactivate', 'airline', airline.id).expect(200);
      expect(await ids()).toContain(flightId);
      await http().get(`/api/flights/${flightId}`).expect(200);
      await hold().expect(201);
    });
  });
});
