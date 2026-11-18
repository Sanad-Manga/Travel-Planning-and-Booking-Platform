import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { BookingStatus, BookingType, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { FlightsModule } from '../src/flights/flights.module';
import {
  EXCHANGE_RATE_PROVIDER,
  FetchedRates,
} from '../src/fx/exchange-rate-provider';
import { ItinerariesModule } from '../src/itineraries';
import { setupApp, setupSwagger } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';
const HOTEL_CENTS = 30_000;
const FLIGHT_CENTS = 50_000;

describe('link confirmed bookings to itinerary days (ITN-27) over HTTP', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;
  let uploadRoot: string;
  let alice: string;
  let aliceId: string;
  let bob: string;
  let bobId: string;
  let admin: string;

  const http = () => request(app.getHttpServer());
  const linkRows = () => db.collection('itineraryBookings').find({}).toArray();

  async function loginAs(
    email: string,
    role: Role = Role.USER,
  ): Promise<{ cookie: string; id: string }> {
    await db.collection('users').insertOne({
      name: email,
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const response = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      id: response.body.id,
      cookie: (response.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; '),
    };
  }

  /** An itinerary of `cookie` with two days (Cairo, Dubai). */
  async function itineraryWithDays(
    cookie = alice,
  ): Promise<{ id: string; day1: string; day2: string }> {
    const created = await http()
      .post('/api/itineraries')
      .set('Cookie', cookie)
      .send({
        title: 'Trip',
        countryCodes: ['EG', 'AE'],
        startDate: '2026-12-20',
      })
      .expect(201);
    const id = created.body.id as string;
    const first = await http()
      .post(`/api/itineraries/${id}/days`)
      .set('Cookie', cookie)
      .send({ cityId: 'cairo' })
      .expect(201);
    const second = await http()
      .post(`/api/itineraries/${id}/days`)
      .set('Cookie', cookie)
      .send({ cityId: 'dubai' })
      .expect(201);
    return {
      id,
      day1: first.body.id as string,
      day2: second.body.id as string,
    };
  }

  async function hotelBooking(
    userId: string,
    status = BookingStatus.CONFIRMED,
    totalCents = HOTEL_CENTS,
    currency = 'USD',
  ): Promise<string> {
    const _id = new Types.ObjectId();
    await db.collection('hotelBookings').insertOne({
      _id,
      userId: new Types.ObjectId(userId),
      hotelId: new Types.ObjectId(),
      checkIn: '2026-12-20',
      checkOut: '2026-12-22',
      nights: 2,
      rooms: [],
      totalCents,
      currency,
      status,
      bookingReference: `HTL-${_id.toHexString().slice(-12).toUpperCase()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return _id.toHexString();
  }

  async function flightBooking(
    userId: string,
    status = BookingStatus.CONFIRMED,
    totalCents = FLIGHT_CENTS,
    currency = 'USD',
  ): Promise<string> {
    const _id = new Types.ObjectId();
    await db.collection('flightBookings').insertOne({
      _id,
      userId: new Types.ObjectId(userId),
      totalCents,
      currency,
      status,
      bookingReference: `FLT-${_id.toHexString().slice(-12).toUpperCase()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return _id.toHexString();
  }

  const link = (
    cookie: string,
    itineraryId: string,
    body: Record<string, unknown>,
  ) =>
    http()
      .post(`/api/itineraries/${itineraryId}/bookings`)
      .set('Cookie', cookie)
      .send(body);
  const summaryOf = async (id: string, cookie = alice) =>
    (
      await http()
        .get(`/api/itineraries/${id}/budget-summary`)
        .set('Cookie', cookie)
        .expect(200)
    ).body;
  interface CurrencyBlock {
    currency: string;
    totalCents: number;
    byCategory: Array<{ category: string; totalCents: number }>;
    byDay: Array<{ dayId: string; totalCents: number }>;
  }
  const usd = (summary: { totals: CurrencyBlock[] }): CurrencyBlock => {
    const block = summary.totals.find((t) => t.currency === 'USD');
    if (!block) throw new Error('no USD block in the summary');
    return block;
  };
  const category = (block: CurrencyBlock, name: string) =>
    block.byCategory.find((c) => c.category === name)?.totalCents;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uploadRoot = await fs.mkdtemp(join(tmpdir(), 'itn27-e2e-'));
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        // FlightsModule registers the FLIGHT booking provider (ItinerariesModule already brings HotelsModule for HOTEL).
        FlightsModule,
        ItinerariesModule,
      ],
    })
      .overrideProvider(EXCHANGE_RATE_PROVIDER)
      .useValue({
        fetchLatest: (base: string): Promise<FetchedRates> =>
          Promise.resolve({
            base,
            rateDate: new Date().toISOString().slice(0, 10),
            rates: { EGP: 48, EUR: 0.85 },
          }),
      })
      .overrideProvider(UPLOAD_OPTIONS)
      .useValue({
        root: uploadRoot,
        leaseMs: 60_000,
        recoveryIntervalMs: 3_600_000,
        recoveryBatchSize: 50,
      })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    await db.model('User').init();
    await db.model('ItineraryBooking').init();

    await db.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
    ]);
    await db.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'dubai', name: 'Dubai', country_code: 'AE' },
    ]);
    await db
      .collection('currencies')
      .insertMany([{ code: 'USD' }, { code: 'EGP' }, { code: 'EUR' }]);

    const a = await loginAs('itn27-alice@example.com');
    alice = a.cookie;
    aliceId = a.id;
    const b = await loginAs('itn27-bob@example.com');
    bob = b.cookie;
    bobId = b.id;
    admin = (await loginAs('itn27-admin@example.com', Role.ADMIN)).cookie;
  }, 180_000);

  beforeEach(async () => {
    await db.collection('itineraries').deleteMany({});
    await db.collection('budgets').deleteMany({});
    await db.collection('itineraryBookings').deleteMany({});
    await db.collection('hotelBookings').deleteMany({});
    await db.collection('flightBookings').deleteMany({});
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    await fs.rm(uploadRoot, { recursive: true, force: true });
  });

  describe('access', () => {
    it('refuses a guest (401) and an admin (403)', async () => {
      const { id, day1 } = await itineraryWithDays();
      const bookingId = await hotelBooking(aliceId);
      const body = { bookingType: BookingType.HOTEL, bookingId, dayId: day1 };
      await http()
        .post(`/api/itineraries/${id}/bookings`)
        .send(body)
        .expect(401);
      await link(admin, id, body).expect(403);
      expect(await linkRows()).toHaveLength(0);
    });
  });

  describe('linking', () => {
    it('links a confirmed hotel booking to a day and answers with the link and the budget line it feeds', async () => {
      const { id, day1 } = await itineraryWithDays();
      const bookingId = await hotelBooking(aliceId);

      const response = await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId,
        dayId: day1,
      }).expect(201);

      expect(response.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        itineraryId: id,
        dayId: day1,
        bookingType: BookingType.HOTEL,
        bookingId,
        category: 'ACCOMMODATION',
        amountCents: HOTEL_CENTS,
        currency: 'USD',
      });
      expect(await linkRows()).toHaveLength(1);
    });

    it('links a confirmed flight booking: it counts as intercity transport', async () => {
      const { id, day2 } = await itineraryWithDays();
      const bookingId = await flightBooking(aliceId);

      const response = await link(alice, id, {
        bookingType: BookingType.FLIGHT,
        bookingId,
        dayId: day2,
      }).expect(201);

      expect(response.body).toMatchObject({
        bookingType: BookingType.FLIGHT,
        category: 'INTERCITY_TRANSPORT',
        amountCents: FLIGHT_CENTS,
      });
    });

    it('refuses the same booking twice with 409, on the same day or another one, and keeps one link', async () => {
      const { id, day1, day2 } = await itineraryWithDays();
      const bookingId = await hotelBooking(aliceId);
      await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId,
        dayId: day1,
      }).expect(201);

      await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId,
        dayId: day1,
      }).expect(409);
      await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId,
        dayId: day2,
      }).expect(409);

      expect(await linkRows()).toHaveLength(1);
    });

    it('lets exactly one of two simultaneous identical requests win', async () => {
      const { id, day1 } = await itineraryWithDays();
      const bookingId = await hotelBooking(aliceId);
      const body = { bookingType: BookingType.HOTEL, bookingId, dayId: day1 };

      const results = await Promise.all([
        link(alice, id, body),
        link(alice, id, body),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await linkRows()).toHaveLength(1);
    });

    it.each([
      ['PENDING_PAYMENT', BookingStatus.PENDING_PAYMENT],
      ['CANCELLED', BookingStatus.CANCELLED],
      ['EXPIRED', BookingStatus.EXPIRED],
      ['COMPLETED', BookingStatus.COMPLETED],
    ])(
      'refuses a %s booking with 409: only CONFIRMED bookings can be linked',
      async (_label, status) => {
        const { id, day1 } = await itineraryWithDays();
        const bookingId = await hotelBooking(aliceId, status);
        const response = await link(alice, id, {
          bookingType: BookingType.HOTEL,
          bookingId,
          dayId: day1,
        }).expect(409);
        expect(response.body.message).toEqual(
          expect.stringContaining('CONFIRMED'),
        );
        expect(await linkRows()).toHaveLength(0);
      },
    );

    it("answers 404 for someone else's booking, an unknown booking and a booking of the other type", async () => {
      const { id, day1 } = await itineraryWithDays();
      const bobsHotel = await hotelBooking(bobId);
      const alicesHotel = await hotelBooking(aliceId);
      for (const body of [
        { bookingType: BookingType.HOTEL, bookingId: bobsHotel, dayId: day1 },
        {
          bookingType: BookingType.HOTEL,
          bookingId: new Types.ObjectId().toHexString(),
          dayId: day1,
        },
        {
          bookingType: BookingType.FLIGHT,
          bookingId: alicesHotel,
          dayId: day1,
        },
      ]) {
        await link(alice, id, body).expect(404);
      }
      expect(await linkRows()).toHaveLength(0);
    });

    it("answers 404 for someone else's itinerary, an unknown itinerary and a day that is not on this itinerary", async () => {
      const mine = await itineraryWithDays();
      const bobs = await itineraryWithDays(bob);
      const bookingId = await hotelBooking(aliceId);
      await link(alice, bobs.id, {
        bookingType: BookingType.HOTEL,
        bookingId,
        dayId: bobs.day1,
      }).expect(404);
      await link(alice, new Types.ObjectId().toHexString(), {
        bookingType: BookingType.HOTEL,
        bookingId,
        dayId: mine.day1,
      }).expect(404);
      await link(alice, mine.id, {
        bookingType: BookingType.HOTEL,
        bookingId,
        dayId: bobs.day1,
      }).expect(404);
      await link(alice, mine.id, {
        bookingType: BookingType.HOTEL,
        bookingId,
        dayId: new Types.ObjectId().toHexString(),
      }).expect(404);
      expect(await linkRows()).toHaveLength(0);
    });

    it('answers 400 with the field in details for a bad body', async () => {
      const { id, day1 } = await itineraryWithDays();
      const bookingId = await hotelBooking(aliceId);
      const good = { bookingType: BookingType.HOTEL, bookingId, dayId: day1 };
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ bookingId, dayId: day1 }, 'bookingType'],
        [{ ...good, bookingType: 'CAR' }, 'bookingType'],
        [{ ...good, bookingId: 'nope' }, 'bookingId'],
        [{ bookingType: good.bookingType, dayId: day1 }, 'bookingId'],
        [{ ...good, dayId: 'nope' }, 'dayId'],
        [{ bookingType: good.bookingType, bookingId }, 'dayId'],
        [{ ...good, amountCents: 1 }, 'amountCents'],
      ];
      for (const [body, field] of cases) {
        const response = await link(alice, id, body).expect(400);
        expect(
          response.body.details.map((d: { field: string }) => d.field),
        ).toContain(field);
      }
      await http()
        .post(`/api/itineraries/not-an-id/bookings`)
        .set('Cookie', alice)
        .send(good)
        .expect(400);
      expect(await linkRows()).toHaveLength(0);
    });
  });

  describe('the budget', () => {
    it('adds the linked amounts to the budget summary, by category and by day, without double counting', async () => {
      const { id, day1, day2 } = await itineraryWithDays();
      await http()
        .post(`/api/itineraries/${id}/days/${day1}/budgets`)
        .set('Cookie', alice)
        .send({ category: 'FOOD', amountCents: 1_000, currency: 'USD' })
        .expect(201);
      await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId: await hotelBooking(aliceId),
        dayId: day1,
      }).expect(201);
      const flightId = await flightBooking(aliceId);
      await link(alice, id, {
        bookingType: BookingType.FLIGHT,
        bookingId: flightId,
        dayId: day2,
      }).expect(201);
      await link(alice, id, {
        bookingType: BookingType.FLIGHT,
        bookingId: flightId,
        dayId: day2,
      }).expect(409); // a repeat must not count twice

      const summary = await summaryOf(id);

      const block = usd(summary);
      expect(block.totalCents).toBe(1_000 + HOTEL_CENTS + FLIGHT_CENTS);
      expect(category(block, 'FOOD')).toBe(1_000);
      expect(category(block, 'ACCOMMODATION')).toBe(HOTEL_CENTS);
      expect(category(block, 'INTERCITY_TRANSPORT')).toBe(FLIGHT_CENTS);
      expect(block.byDay.map((d) => d.totalCents)).toEqual([
        1_000 + HOTEL_CENTS,
        FLIGHT_CENTS,
      ]);
      expect(block.byDay.reduce((sum, d) => sum + d.totalCents, 0)).toBe(
        block.totalCents,
      );
      expect(summary.convertedTotal).toMatchObject({
        currency: 'USD',
        totalCents: 1_000 + HOTEL_CENTS + FLIGHT_CENTS,
      });
    });

    it("keeps a booking's own currency in its own block of the summary", async () => {
      const { id, day1 } = await itineraryWithDays();
      await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId: await hotelBooking(
          aliceId,
          BookingStatus.CONFIRMED,
          9_600,
          'EUR',
        ),
        dayId: day1,
      }).expect(201);

      const summary = await summaryOf(id);

      expect(summary.totals).toHaveLength(1);
      expect(summary.totals[0]).toMatchObject({
        currency: 'EUR',
        totalCents: 9_600,
      });
    });

    it('feeds the day subtotals of the itinerary view too', async () => {
      const { id, day1 } = await itineraryWithDays();
      await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId: await hotelBooking(aliceId),
        dayId: day1,
      }).expect(201);

      const itinerary = await http()
        .get(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(200);

      expect(itinerary.body.cityGroups[0].subtotalCents).toBe(HOTEL_CENTS);
      expect(itinerary.body.budgets).toEqual([]); // links are not daily budget entries
    });

    it('stops counting a linked booking once it is cancelled, and keeps counting it once it is completed', async () => {
      const { id, day1 } = await itineraryWithDays();
      const bookingId = await hotelBooking(aliceId);
      await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId,
        dayId: day1,
      }).expect(201);
      expect(usd(await summaryOf(id)).totalCents).toBe(HOTEL_CENTS);

      await db
        .collection('hotelBookings')
        .updateOne(
          { _id: new Types.ObjectId(bookingId) },
          { $set: { status: BookingStatus.CANCELLED } },
        );
      expect((await summaryOf(id)).totals).toEqual([]);

      await db
        .collection('hotelBookings')
        .updateOne(
          { _id: new Types.ObjectId(bookingId) },
          { $set: { status: BookingStatus.COMPLETED } },
        );
      expect(usd(await summaryOf(id)).totalCents).toBe(HOTEL_CENTS);
    });

    it('drops the links of a deleted day and of a deleted itinerary', async () => {
      const { id, day1, day2 } = await itineraryWithDays();
      await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId: await hotelBooking(aliceId),
        dayId: day1,
      }).expect(201);
      await link(alice, id, {
        bookingType: BookingType.FLIGHT,
        bookingId: await flightBooking(aliceId),
        dayId: day2,
      }).expect(201);

      await http()
        .delete(`/api/itineraries/${id}/days/${day1}`)
        .set('Cookie', alice)
        .expect(204);
      expect((await linkRows()).map((row) => row.bookingType)).toEqual([
        BookingType.FLIGHT,
      ]);
      expect(usd(await summaryOf(id)).totalCents).toBe(FLIGHT_CENTS);

      await http()
        .delete(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .expect(204);
      expect(await linkRows()).toHaveLength(0);
    });

    it('leaves the linked bookings out of the public view and out of a clone: bookings belong to their owner', async () => {
      const { id, day1 } = await itineraryWithDays();
      await link(alice, id, {
        bookingType: BookingType.HOTEL,
        bookingId: await hotelBooking(aliceId),
        dayId: day1,
      }).expect(201);
      await http()
        .patch(`/api/itineraries/${id}`)
        .set('Cookie', alice)
        .send({ visibility: 'PUBLIC' })
        .expect(200);

      const clone = await http()
        .post(`/api/itineraries/${id}/clone`)
        .set('Cookie', bob)
        .expect(201);

      expect((await summaryOf(clone.body.id, bob)).totals).toEqual([]);
      const publicView = await http()
        .get(`/api/itineraries/public/${id}`)
        .expect(200);
      expect(publicView.body.budget.totals).toEqual([]);
      expect(await linkRows()).toHaveLength(1);
    });
  });

  it('documents the route in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const route = response.body.paths['/api/itineraries/{id}/bookings'].post;
    expect(route.summary).toContain('ITN-27');
    expect(Object.keys(route.responses)).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404', '409']),
    );
  });
});
