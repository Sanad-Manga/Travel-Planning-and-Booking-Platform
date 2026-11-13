import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AirlinesModule } from '../src/airlines';
import { AuthModule } from '../src/auth/auth.module';
import { BookingStatus, BookingType, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { FlightsModule } from '../src/flights';
import { FlightBooking } from '../src/flights/schemas/flight-booking.schema';
import { NotificationsModule } from '../src/notifications';
import { BookingLifecycle, PaymentsModule } from '../src/payments';
import { ReferenceDataModule } from '../src/reference-data/reference-data.module';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/**
 * FLT-22: seat hold. Runs on an in-memory MongoDB REPLICA SET, because the hold and the status changes use
 * MongoDB transactions (a single-node server does not support them).
 */
describe('flight seat hold (FLT-22) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  let lifecycle: BookingLifecycle;
  let bookingModel: Model<FlightBooking>;

  const PASSWORD = 'Passw0rdOK';
  const HOLD = '/api/flight-bookings/hold';
  const http = () => request(app.getHttpServer());

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

  let admin: string;
  let traveler: string;
  let moderator: string;
  let airline: { id: string };
  let travelerId: string;

  /** A flight created through the real FLT-03 endpoint (far in the future). */
  async function createFlight(overrides: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/flights')
      .set('Cookie', moderator)
      .send({
        flightNumber: 'MS777',
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureLocalTime: '2090-12-01T14:30',
        arrivalLocalTime: '2090-12-01T19:45',
        ...overrides,
      })
      .expect(201);
    return res.body.id as string;
  }

  /** Cabins cannot be created through the API yet (FLT-04), so tests insert them directly. */
  async function addCabin(
    flightId: string,
    cabinClass: string,
    totalSeats: number,
    bookedSeats = 0,
    heldSeats = 0,
    priceCents = 45000,
  ) {
    await connection.collection('cabins').insertOne({
      flightId: new Types.ObjectId(flightId),
      cabinClass,
      totalSeats,
      bookedSeats,
      heldSeats,
      priceCents,
      freeBags: 1,
      maxBagWeightKg: 23,
    });
  }

  const cabinOf = (flightId: string, cabinClass = 'ECONOMY') =>
    connection
      .collection('cabins')
      .findOne({ flightId: new Types.ObjectId(flightId), cabinClass });

  const body = (flightId: string, extra: Record<string, unknown> = {}) => ({
    flightId,
    cabinClass: 'ECONOMY',
    adults: 1,
    ...extra,
  });

  /** Holds seats through the API and returns the booking id. */
  async function hold(flightId: string, extra: Record<string, unknown> = {}) {
    const res = await http()
      .post(HOLD)
      .set('Cookie', traveler)
      .send(body(flightId, extra))
      .expect(201);
    return res.body.id as string;
  }

  const expireNow = (bookingId: string) =>
    connection
      .collection('flightBookings')
      .updateOne(
        { _id: new Types.ObjectId(bookingId) },
        { $set: { holdExpiresAt: new Date(Date.now() - 60_000) } },
      );

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';

    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        AirlinesModule,
        ReferenceDataModule,
        NotificationsModule,
        PaymentsModule,
        FlightsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.listen(0, '127.0.0.1');
    connection = app.get<Connection>(getConnectionToken());
    lifecycle = app.get(BookingLifecycle);
    bookingModel = app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    await connection.model('User').init();
    await connection.model('Airline').init();
    await connection.model('Flight').init();
    await bookingModel.init();

    await connection.collection('airports').insertMany([
      {
        iata_code: 'CAI',
        name: 'Cairo',
        city_id: 'c1',
        country_code: 'EG',
        time_zone: 'Africa/Cairo',
      },
      {
        iata_code: 'JFK',
        name: 'John F. Kennedy',
        city_id: 'c2',
        country_code: 'US',
        time_zone: 'America/New_York',
      },
    ]);

    admin = await loginAs('admin@example.com', { role: Role.ADMIN });
    traveler = await loginAs('traveler@example.com');
    travelerId = (await connection
      .collection('users')
      .findOne({ email: 'traveler@example.com' }))!._id.toString();
    airline = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline A', code: 'AA' })
        .expect(201)
    ).body;
    moderator = await loginAs('moda@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(airline.id),
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      ['flights', 'cabins', 'flightBookings', 'notifications'].map((name) =>
        connection.collection(name).deleteMany({}),
      ),
    );
    await connection
      .collection('airlines')
      .updateOne(
        { _id: new Types.ObjectId(airline.id) },
        { $set: { isActive: true } },
      );
  });

  describe('POST /api/flight-bookings/hold', () => {
    it('holds seats: 201, PENDING_PAYMENT, expiry 10 minutes ahead, seats held, price from the cabin', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 100, 30, 5, 45000);
      const before = Date.now();

      const res = await http()
        .post(HOLD)
        .set('Cookie', traveler)
        .send(body(flightId, { adults: 2, children: 1 }))
        .expect(201);

      expect(res.body).toMatchObject({
        flightId,
        cabinClass: 'ECONOMY',
        passengerCounts: { adults: 2, children: 1, infants: 0 },
        seats: 3,
        farePerPassengerCents: 45000,
        infantFareCents: 4500,
        totalCents: 3 * 45000,
        status: 'PENDING_PAYMENT',
      });
      expect(typeof res.body.currency).toBe('string');
      expect(res.body.id).toMatch(/^[0-9a-f]{24}$/);
      expect(res.body._id).toBeUndefined();
      expect(res.body.__v).toBeUndefined();

      const expiresIn = new Date(res.body.holdExpiresAt).getTime() - before;
      expect(expiresIn).toBeGreaterThan(9 * 60_000);
      expect(expiresIn).toBeLessThan(11 * 60_000);

      expect(await cabinOf(flightId)).toMatchObject({
        heldSeats: 8,
        bookedSeats: 30,
      });
      const stored = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(res.body.id) });
      expect(stored?.userId.toString()).toBe(travelerId);
      expect(stored?.airlineId.toString()).toBe(airline.id);
    });

    it('infants take no seat and pay 10% of the fare', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 100, 0, 0, 45000);

      const res = await http()
        .post(HOLD)
        .set('Cookie', traveler)
        .send(body(flightId, { adults: 2, children: 1, infants: 2 }))
        .expect(201);

      expect(res.body.seats).toBe(3);
      expect(res.body.totalCents).toBe(3 * 45000 + 2 * 4500);
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 3 });
    });

    it('a cabin with exactly the seats needed can be held; the next request gets 409', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 1);
      await http()
        .post(HOLD)
        .set('Cookie', traveler)
        .send(body(flightId))
        .expect(201);
      await http()
        .post(HOLD)
        .set('Cookie', traveler)
        .send(body(flightId))
        .expect(409);
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 1 });
    });

    it('availability seen by search drops after a hold', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10, 0, 0, 45000);
      await hold(flightId, { adults: 4 });
      const res = await http()
        .get('/api/flights/search')
        .query({
          departureAirport: 'CAI',
          arrivalAirport: 'JFK',
          departureDate: '2090-12-01',
          passengers: 1,
        })
        .expect(200);
      expect(res.body.items[0].cabins[0].availableSeats).toBe(6);
    });

    describe('validation (400, nothing is held)', () => {
      const failsOn = async (
        payload: Record<string, unknown>,
        field: string,
      ) => {
        const res = await http()
          .post(HOLD)
          .set('Cookie', traveler)
          .send(payload)
          .expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
        expect(
          await connection.collection('flightBookings').countDocuments(),
        ).toBe(0);
      };

      it('no adult', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 10);
        await failsOn(body(flightId, { adults: 0 }), 'adults');
        expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
      });

      it('more infants than adults', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 10);
        await failsOn(body(flightId, { adults: 1, infants: 2 }), 'infants');
        expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
      });

      it('bad flightId, bad cabin, negative or fractional counts', async () => {
        const flightId = await createFlight();
        await failsOn(body('not-an-id'), 'flightId');
        await failsOn(body(flightId, { cabinClass: 'LUXURY' }), 'cabinClass');
        await failsOn(body(flightId, { children: -1 }), 'children');
        await failsOn(body(flightId, { adults: 1.5 }), 'adults');
      });

      it('fields the server controls are rejected, not obeyed', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 10);
        await failsOn(body(flightId, { totalCents: 1 }), 'totalCents');
        await failsOn(
          body(flightId, { userId: new Types.ObjectId().toString() }),
          'userId',
        );
        await failsOn(body(flightId, { status: 'CONFIRMED' }), 'status');
      });

      it('errors use the contract shape', async () => {
        const res = await http()
          .post(HOLD)
          .set('Cookie', traveler)
          .send({})
          .expect(400);
        expect(res.body).toMatchObject({
          statusCode: 400,
          error: 'Bad Request',
          path: HOLD,
        });
        expect(typeof res.body.timestamp).toBe('string');
      });
    });

    describe('not found and conflicts (nothing is held)', () => {
      it('unknown flight: 404', async () => {
        await http()
          .post(HOLD)
          .set('Cookie', traveler)
          .send(body(new Types.ObjectId().toString()))
          .expect(404);
      });

      it('the flight has no such cabin: 404', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 10);
        await http()
          .post(HOLD)
          .set('Cookie', traveler)
          .send(body(flightId, { cabinClass: 'FIRST' }))
          .expect(404);
      });

      it('not enough seats: 409 and the counters do not change', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 5, 2, 1); // 2 available
        await http()
          .post(HOLD)
          .set('Cookie', traveler)
          .send(body(flightId, { adults: 3 }))
          .expect(409);
        expect(await cabinOf(flightId)).toMatchObject({
          bookedSeats: 2,
          heldSeats: 1,
        });
        expect(
          await connection.collection('flightBookings').countDocuments(),
        ).toBe(0);
      });

      it.each(['CANCELLED', 'DEPARTED'])(
        'a %s flight cannot be held: 409',
        async (status) => {
          const flightId = await createFlight();
          await addCabin(flightId, 'ECONOMY', 10);
          await connection
            .collection('flights')
            .updateOne(
              { _id: new Types.ObjectId(flightId) },
              { $set: { status } },
            );
          await http()
            .post(HOLD)
            .set('Cookie', traveler)
            .send(body(flightId))
            .expect(409);
          expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
        },
      );

      it('a flight whose departure has passed cannot be held: 409', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 10);
        await connection
          .collection('flights')
          .updateOne(
            { _id: new Types.ObjectId(flightId) },
            { $set: { departureAt: new Date(Date.now() - 3_600_000) } },
          );
        await http()
          .post(HOLD)
          .set('Cookie', traveler)
          .send(body(flightId))
          .expect(409);
      });

      it('a deactivated airline cannot be booked: 409', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 10);
        await connection
          .collection('airlines')
          .updateOne(
            { _id: new Types.ObjectId(airline.id) },
            { $set: { isActive: false } },
          );
        await http()
          .post(HOLD)
          .set('Cookie', traveler)
          .send(body(flightId))
          .expect(409);
      });
    });

    describe('who may call it', () => {
      it('a guest gets 401', async () => {
        await http()
          .post(HOLD)
          .send(body(new Types.ObjectId().toString()))
          .expect(401);
      });

      it.each([
        ['admin', () => admin],
        ['airline moderator', () => moderator],
      ])('%s gets 403', async (_name, cookie) => {
        await http()
          .post(HOLD)
          .set('Cookie', cookie())
          .send(body(new Types.ObjectId().toString()))
          .expect(403);
      });
    });

    describe('concurrency: seats are never over-held', () => {
      it('20 parallel holds of 1 seat for the last 5 seats: exactly 5 succeed, no seat is over-held', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 5);

        const results = await Promise.all(
          Array.from({ length: 20 }, () =>
            http().post(HOLD).set('Cookie', traveler).send(body(flightId)),
          ),
        );

        const statuses = results.map((r) => r.status);
        expect(statuses.filter((s) => s === 201)).toHaveLength(5);
        expect(statuses.filter((s) => s === 409)).toHaveLength(15);
        expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
        expect(await cabinOf(flightId)).toMatchObject({
          heldSeats: 5,
          bookedSeats: 0,
        });
        expect(
          await connection
            .collection('flightBookings')
            .countDocuments({ status: 'PENDING_PAYMENT' }),
        ).toBe(5);
      }, 90_000);

      it('parallel holds of 2 seats for 5 seats: exactly 2 succeed', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 5);

        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            http()
              .post(HOLD)
              .set('Cookie', traveler)
              .send(body(flightId, { adults: 2 })),
          ),
        );

        expect(results.filter((r) => r.status === 201)).toHaveLength(2);
        expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(
          true,
        );
        expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 4 });
      }, 90_000);
    });

    it('is atomic: if the booking cannot be saved, the seats are not held either (rollback)', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      jest
        .spyOn(bookingModel, 'create')
        .mockRejectedValueOnce(new Error('boom') as never);

      await http()
        .post(HOLD)
        .set('Cookie', traveler)
        .send(body(flightId, { adults: 3 }))
        .expect(500);

      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
      expect(
        await connection.collection('flightBookings').countDocuments(),
      ).toBe(0);
    });
  });

  describe('expiry, confirmation and cancellation through BookingLifecycle', () => {
    it('an expired hold becomes EXPIRED and its seats are released (lazy expiry)', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const id = await hold(flightId, { adults: 3 });
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 3 });

      await expireNow(id);
      await expect(lifecycle.expireIfDue(BookingType.FLIGHT, id)).resolves.toBe(
        true,
      );

      const stored = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(id) });
      expect(stored?.status).toBe(BookingStatus.EXPIRED);
      expect(stored?.holdExpiresAt).toBeUndefined();
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });

      // Running it again must not release the seats twice.
      await expect(lifecycle.expireIfDue(BookingType.FLIGHT, id)).resolves.toBe(
        false,
      );
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
    });

    it('a hold that has not run out yet is left alone', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const id = await hold(flightId);
      await expect(lifecycle.expireIfDue(BookingType.FLIGHT, id)).resolves.toBe(
        false,
      );
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 1 });
    });

    it('the sweep expires every due hold and releases all their seats, and only those', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 20);
      const due1 = await hold(flightId, { adults: 2 });
      const due2 = await hold(flightId, { adults: 3 });
      const fresh = await hold(flightId, { adults: 4 });
      await expireNow(due1);
      await expireNow(due2);

      await expect(lifecycle.sweepExpiredHolds()).resolves.toBe(2);

      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 4 });
      const status = async (id: string) =>
        (
          await connection
            .collection('flightBookings')
            .findOne({ _id: new Types.ObjectId(id) })
        )?.status;
      expect(await status(due1)).toBe(BookingStatus.EXPIRED);
      expect(await status(due2)).toBe(BookingStatus.EXPIRED);
      expect(await status(fresh)).toBe(BookingStatus.PENDING_PAYMENT);
    });

    it('released seats can be held again', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 2);
      const id = await hold(flightId, { adults: 2 });
      await http()
        .post(HOLD)
        .set('Cookie', traveler)
        .send(body(flightId))
        .expect(409);
      await expireNow(id);
      await lifecycle.sweepExpiredHolds();
      await http()
        .post(HOLD)
        .set('Cookie', traveler)
        .send(body(flightId))
        .expect(201);
    });

    it('confirming a paid booking turns held seats into booked seats, once, and notifies the traveler', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const id = await hold(flightId, { adults: 3, infants: 1 });

      await lifecycle.confirmPaid(BookingType.FLIGHT, id, 'pi_test_1');

      const stored = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(id) });
      expect(stored).toMatchObject({
        status: 'CONFIRMED',
        paymentRef: 'pi_test_1',
      });
      expect(stored?.holdExpiresAt).toBeUndefined();
      expect(await cabinOf(flightId)).toMatchObject({
        heldSeats: 0,
        bookedSeats: 3,
      });

      const notifications = await connection
        .collection('notifications')
        .find({
          userId: new Types.ObjectId(travelerId),
          type: 'BOOKING_CONFIRMED',
        })
        .toArray();
      expect(notifications).toHaveLength(1);

      // The webhook and the late-paid path can both arrive: the second call changes and sends nothing.
      await lifecycle.confirmPaid(BookingType.FLIGHT, id, 'pi_test_1');
      expect(await cabinOf(flightId)).toMatchObject({
        heldSeats: 0,
        bookedSeats: 3,
      });
      expect(
        await connection
          .collection('notifications')
          .countDocuments({ type: 'BOOKING_CONFIRMED' }),
      ).toBe(1);
    });

    it('a different payment reference cannot confirm an already confirmed booking', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const id = await hold(flightId);
      await lifecycle.confirmPaid(BookingType.FLIGHT, id, 'pi_test_1');
      await expect(
        lifecycle.confirmPaid(BookingType.FLIGHT, id, 'pi_other'),
      ).rejects.toThrow();
      expect(await cabinOf(flightId)).toMatchObject({
        heldSeats: 0,
        bookedSeats: 1,
      });
    });

    it('an expired booking cannot be confirmed and its seats stay released', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const id = await hold(flightId, { adults: 2 });
      await expireNow(id);
      await lifecycle.sweepExpiredHolds();
      await expect(
        lifecycle.confirmPaid(BookingType.FLIGHT, id, 'pi_late'),
      ).rejects.toThrow();
      expect(await cabinOf(flightId)).toMatchObject({
        heldSeats: 0,
        bookedSeats: 0,
      });
    });

    it('cancelling a confirmed booking gives its booked seats back', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const id = await hold(flightId, { adults: 4 });
      await lifecycle.confirmPaid(BookingType.FLIGHT, id, 'pi_test_1');
      expect(await cabinOf(flightId)).toMatchObject({ bookedSeats: 4 });

      await lifecycle.transition(
        BookingType.FLIGHT,
        id,
        BookingStatus.CANCELLED,
      );

      expect(await cabinOf(flightId)).toMatchObject({
        bookedSeats: 0,
        heldSeats: 0,
      });
      expect(
        (
          await connection
            .collection('flightBookings')
            .findOne({ _id: new Types.ObjectId(id) })
        )?.status,
      ).toBe(BookingStatus.CANCELLED);
    });

    it('a pending booking cannot be cancelled (only CONFIRMED can) and nothing changes', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const id = await hold(flightId, { adults: 2 });
      await expect(
        lifecycle.transition(BookingType.FLIGHT, id, BookingStatus.CANCELLED),
      ).rejects.toThrow();
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 2 });
    });

    it('unknown booking ids are 404, never a crash', async () => {
      await expect(
        lifecycle.confirmPaid(
          BookingType.FLIGHT,
          new Types.ObjectId().toString(),
          'pi_x',
        ),
      ).rejects.toThrow();
      await expect(
        lifecycle.expireIfDue(BookingType.FLIGHT, 'not-an-id'),
      ).resolves.toBe(false);
    });
  });
});
