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
import { FlightBookingProvider } from '../src/flights/flight-booking.provider';
import { FlightETicketService } from '../src/flights/flight-eticket.service';
import { FlightBooking } from '../src/flights/schemas/flight-booking.schema';
import { NotificationsModule } from '../src/notifications';
import {
  BookingLifecycle,
  PAYMENT_ACTIVITY,
  PaymentsModule,
  PrepareExpiryResult,
} from '../src/payments';
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
  let bookingProvider: FlightBookingProvider;
  let etickets: FlightETicketService;

  const PASSWORD = 'Passw0rdOK';
  const HOLD = '/api/flight-bookings/hold';
  const BOOKING = '/api/flight-bookings';
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
  let otherTraveler: string;
  let moderator: string;
  let returnModerator: string;
  let airline: { id: string };
  let returnAirline: { id: string };
  let travelerId: string;

  /**
   * Test seam for the late-paid path: BookingLifecycle asks PaymentActivity what to do with an
   * overdue hold. The real Stripe implementation needs a PaymentIntent, so this stand-in returns
   * EXPIRE by default and PAID only in the focused late-paid test — no Stripe event is involved.
   */
  let nextPrepareExpiry: PrepareExpiryResult = 'EXPIRE';
  const paymentActivity = {
    prepareExpiry: (): Promise<PrepareExpiryResult> =>
      Promise.resolve(nextPrepareExpiry),
  };

  /** A flight created through the real FLT-03 endpoint (far in the future). */
  async function createFlight(
    overrides: Record<string, unknown> = {},
    moderatorCookie = moderator,
  ) {
    const res = await http()
      .post('/api/flights')
      .set('Cookie', moderatorCookie)
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

  async function setBaggagePolicy(
    extraBagPriceCents = 3000,
    maxExtraBags = 2,
    airlineId = airline.id,
    moderatorCookie = moderator,
  ) {
    await http()
      .put(`/api/airlines/${airlineId}/baggage-policy`)
      .set('Cookie', moderatorCookie)
      .send({ extraBagPriceCents, maxExtraBags })
      .expect(200);
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
    })
      .overrideProvider(PAYMENT_ACTIVITY)
      .useValue(paymentActivity)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.listen(0, '127.0.0.1');
    connection = app.get<Connection>(getConnectionToken());
    lifecycle = app.get(BookingLifecycle);
    bookingModel = app.get<Model<FlightBooking>>(
      getModelToken(FlightBooking.name),
    );
    bookingProvider = app.get(FlightBookingProvider);
    etickets = app.get(FlightETicketService);
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
    otherTraveler = await loginAs('other-traveler@example.com');
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
    returnAirline = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline B', code: 'BB' })
        .expect(201)
    ).body;
    returnModerator = await loginAs('modb@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(returnAirline.id),
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    nextPrepareExpiry = 'EXPIRE';
    await Promise.all(
      [
        'flights',
        'cabins',
        'flightBookings',
        'refunds',
        'notifications',
      ].map((name) => connection.collection(name).deleteMany({})),
    );
    await connection
      .collection('airlines')
      .updateOne(
        { _id: new Types.ObjectId(airline.id) },
        {
          $set: { isActive: true },
          $unset: { baggagePolicy: '', cancellationTiers: '' },
        },
      );
    await connection
      .collection('airlines')
      .updateOne(
        { _id: new Types.ObjectId(returnAirline.id) },
        {
          $set: { isActive: true },
          $unset: { baggagePolicy: '', cancellationTiers: '' },
        },
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

      it('a flight whose departure has passed cannot be held while its stored status is still SCHEDULED (FLT-30): 409, no seats held', async () => {
        const flightId = await createFlight();
        await addCabin(flightId, 'ECONOMY', 10);
        await connection
          .collection('flights')
          .updateOne(
            { _id: new Types.ObjectId(flightId) },
            { $set: { departureAt: new Date(Date.now() - 3_600_000) } },
          );
        const stored = await connection
          .collection('flights')
          .findOne({ _id: new Types.ObjectId(flightId) });
        expect(stored?.status).toBe('SCHEDULED'); // the status job has not run

        const res = await http()
          .post(HOLD)
          .set('Cookie', traveler)
          .send(body(flightId))
          .expect(409);

        expect(res.body.message).toContain('DEPARTED'); // names the effective status
        expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
        expect(
          await connection.collection('flightBookings').countDocuments(),
        ).toBe(0);
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

  describe('POST /api/flight-bookings (FLT-19)', () => {
    const passenger = (
      fullName: string,
      dateOfBirth: string,
      passportOrIdNumber: string,
      extraBags?: Array<{ weightKg: number }>,
    ) => ({
      fullName,
      dateOfBirth,
      passportOrIdNumber,
      ...(extraBags ? { extraBags } : {}),
    });

    it('derives age groups at the departure-date boundaries and includes baggage fees in cents', async () => {
      await setBaggagePolicy(3000, 2);
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10, 0, 0, 45000);

      const res = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [
            passenger('Adult Passenger', '2078-12-01', 'A1234567', [
              { weightKg: 20 },
            ]),
            passenger('Child Passenger', '2088-12-01', 'C1234567'),
            passenger('Infant Passenger', '2089-12-02', 'I1234567'),
          ],
        })
        .expect(201);

      expect(res.body).toMatchObject({
        flightId,
        passengerCounts: { adults: 1, children: 1, infants: 1 },
        passengers: [
          {
            fullName: 'Adult Passenger',
            dateOfBirth: '2078-12-01',
            passengerType: 'ADULT',
            extraBags: [{ weightKg: 20 }],
            baggageFeeCents: 3000,
          },
          {
            fullName: 'Child Passenger',
            passengerType: 'CHILD',
            extraBags: [],
            baggageFeeCents: 0,
          },
          {
            fullName: 'Infant Passenger',
            passengerType: 'INFANT',
            extraBags: [],
            baggageFeeCents: 0,
          },
        ],
        seats: 2,
        baggageFeeCents: 3000,
        totalCents: 97500,
        status: 'PENDING_PAYMENT',
      });
      expect(res.body.passengers[0]).not.toHaveProperty('passportOrIdNumber');

      const stored = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(res.body.id) });
      expect(stored?.passengers[0].passportOrIdNumber).toBe('A1234567');
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 2 });
    });

    it("documents that passenger type uses the outbound local departure date and publishes no cancellation route", async () => {
      const docs = await http().get('/api/docs-json').expect(200);

      const operation = docs.body.paths['/api/flight-bookings'].post;
      expect(operation.description).toContain(
        "outbound flight's local departure date",
      );
      expect(operation.description).toContain('ADULT 12+');
      expect(operation.description).toContain('CHILD 2-11');
      expect(operation.description).toContain('INFANT under 2');

      expect(
        docs.body.components.schemas.BookingPassengerDto.properties.dateOfBirth
          .description,
      ).toContain("outbound flight's local departure date");

      expect(
        docs.body.paths['/api/flight-bookings/{id}/cancel'],
      ).toBeUndefined();
    });

    it('creates one payable booking with two segments and holds/confirms both legs atomically', async () => {
      await setBaggagePolicy(3000, 2);
      await setBaggagePolicy(5000, 2, returnAirline.id, returnModerator);
      const outboundId = await createFlight();
      const returnId = await createFlight(
        {
          flightNumber: 'BB778',
          departureAirport: 'JFK',
          arrivalAirport: 'CAI',
          departureLocalTime: '2090-12-02T10:00',
          arrivalLocalTime: '2090-12-02T18:30',
        },
        returnModerator,
      );
      await addCabin(outboundId, 'ECONOMY', 10, 0, 0, 45000);
      await addCabin(returnId, 'BUSINESS', 10, 0, 0, 60000);

      const created = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          segments: [
            { flightId: outboundId, cabinClass: 'ECONOMY' },
            { flightId: returnId, cabinClass: 'BUSINESS' },
          ],
          passengers: [
            passenger('Adult Passenger', '2078-12-01', 'A123', [
              { weightKg: 20 },
            ]),
            passenger('Infant Passenger', '2089-12-01', 'I123'),
          ],
        })
        .expect(201);

      expect(created.body).toMatchObject({
        flightId: outboundId,
        passengerCounts: { adults: 1, children: 0, infants: 1 },
        seats: 1,
        baggageFeeCents: 8000,
        totalCents: 123500,
        status: 'PENDING_PAYMENT',
        segments: [
          {
            flightId: outboundId,
            cabinClass: 'ECONOMY',
            seats: 1,
            farePerPassengerCents: 45000,
            infantFareCents: 4500,
            baggageFeeCents: 3000,
          },
          {
            flightId: returnId,
            cabinClass: 'BUSINESS',
            seats: 1,
            farePerPassengerCents: 60000,
            infantFareCents: 6000,
            baggageFeeCents: 5000,
          },
        ],
        passengers: [
          { passengerType: 'ADULT', baggageFeeCents: 8000 },
          { passengerType: 'INFANT', baggageFeeCents: 0 },
        ],
      });
      expect(
        await connection.collection('flightBookings').countDocuments(),
      ).toBe(1);
      expect(await cabinOf(outboundId, 'ECONOMY')).toMatchObject({
        heldSeats: 1,
      });
      expect(await cabinOf(returnId, 'BUSINESS')).toMatchObject({
        heldSeats: 1,
      });
      await expect(
        bookingProvider.getPayable(created.body.id, travelerId),
      ).resolves.toMatchObject({ amountCents: 123500, currency: 'USD' });
      const summary = await http()
        .get(`${BOOKING}/${created.body.id}`)
        .set('Cookie', traveler)
        .expect(200);
      expect(summary.body.totalCents).toBe(123500);
      expect(
        summary.body.segments.map(
          (segment: { flight: { id: string } }) => segment.flight.id,
        ),
      ).toEqual([outboundId, returnId]);

      await lifecycle.confirmPaid(
        BookingType.FLIGHT,
        created.body.id,
        'pi_round_trip_one_reference',
      );
      const stored = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(created.body.id) });
      expect(stored?.paymentRef).toBe('pi_round_trip_one_reference');
      expect(await cabinOf(outboundId, 'ECONOMY')).toMatchObject({
        heldSeats: 0,
        bookedSeats: 1,
      });
      expect(await cabinOf(returnId, 'BUSINESS')).toMatchObject({
        heldSeats: 0,
        bookedSeats: 1,
      });
    });

    it('rolls back the outbound hold if the return leg cannot reserve seats', async () => {
      const outboundId = await createFlight();
      const returnId = await createFlight(
        {
          flightNumber: 'BB778',
          departureAirport: 'JFK',
          arrivalAirport: 'CAI',
          departureLocalTime: '2090-12-02T10:00',
          arrivalLocalTime: '2090-12-02T18:30',
        },
        returnModerator,
      );
      await addCabin(outboundId, 'ECONOMY', 10);
      await addCabin(returnId, 'BUSINESS', 1, 1, 0, 60000);

      await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          segments: [
            { flightId: outboundId, cabinClass: 'ECONOMY' },
            { flightId: returnId, cabinClass: 'BUSINESS' },
          ],
          passengers: [
            {
              fullName: 'Adult Passenger',
              dateOfBirth: '2078-12-01',
              passportOrIdNumber: 'A123',
            },
          ],
        })
        .expect(409);

      expect(await cabinOf(outboundId, 'ECONOMY')).toMatchObject({
        heldSeats: 0,
      });
      expect(await cabinOf(returnId, 'BUSINESS')).toMatchObject({
        heldSeats: 0,
        bookedSeats: 1,
      });
      expect(
        await connection.collection('flightBookings').countDocuments(),
      ).toBe(0);
    });

    it.each([
      ['fullName', { dateOfBirth: '2078-12-01', passportOrIdNumber: 'A123' }],
      ['dateOfBirth', { fullName: 'Passenger', passportOrIdNumber: 'A123' }],
      [
        'passportOrIdNumber',
        { fullName: 'Passenger', dateOfBirth: '2078-12-01' },
      ],
    ])("requires each passenger's %s", async (field, passengerDetails) => {
      const res = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId: new Types.ObjectId().toString(),
          cabinClass: 'ECONOMY',
          passengers: [passengerDetails],
        })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: `passengers.0.${field}` }),
        ]),
      );
    });

    it('rejects invalid and future dates of birth with a field-level error', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const base = {
        flightId,
        cabinClass: 'ECONOMY',
        passengers: [passenger('Passenger', '2090-02-29', 'P123')],
      };

      const invalid = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send(base)
        .expect(400);
      expect(invalid.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'passengers.0.dateOfBirth' }),
        ]),
      );

      const future = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          ...base,
          passengers: [passenger('Passenger', '2091-01-01', 'P123')],
        })
        .expect(400);
      expect(future.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'passengers.0.dateOfBirth' }),
        ]),
      );
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
    });

    it('requires an adult and limits infants to one per adult', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);

      const noAdult = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [passenger('Child', '2088-12-01', 'C123')],
        })
        .expect(400);
      expect(noAdult.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'passengers' }),
        ]),
      );

      const tooManyInfants = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [
            passenger('Adult', '2078-12-01', 'A123'),
            passenger('Infant 1', '2089-12-02', 'I123'),
            passenger('Infant 2', '2089-12-03', 'I456'),
          ],
        })
        .expect(400);
      expect(tooManyInfants.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'passengers' }),
        ]),
      );
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
    });

    it('rejects extra bags when no airline baggage policy exists', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);

      const res = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [
            passenger('Adult', '2078-12-01', 'A123', [{ weightKg: 20 }]),
          ],
        })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'passengers' }),
        ]),
      );
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
    });

    it('rejects bags above the airline maximum without holding seats', async () => {
      await setBaggagePolicy(3000, 1);
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);

      const res = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [
            passenger('Adult', '2078-12-01', 'A123', [
              { weightKg: 20 },
              { weightKg: 21 },
            ]),
          ],
        })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'passengers.0.extraBags' }),
        ]),
      );
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
    });

    it('rejects an extra bag heavier than the cabin limit without holding seats', async () => {
      await setBaggagePolicy();
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);

      const res = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [
            passenger('Adult', '2078-12-01', 'A123', [{ weightKg: 23.01 }]),
          ],
        })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'passengers.0.extraBags.0.weightKg',
          }),
        ]),
      );
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
      expect(
        await connection.collection('flightBookings').countDocuments(),
      ).toBe(0);
    });

    it('allows a passenger booking without extra bags when no baggage policy exists', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);

      const res = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [passenger('Adult', '2078-12-01', 'A123')],
        })
        .expect(201);

      expect(res.body).toMatchObject({
        passengerCounts: { adults: 1, children: 0, infants: 0 },
        baggageFeeCents: 0,
        totalCents: 45000,
      });
    });

    it('requires an authenticated traveler', async () => {
      const payload = {
        flightId: new Types.ObjectId().toString(),
        cabinClass: 'ECONOMY',
        passengers: [passenger('Adult', '2078-12-01', 'A123')],
      };
      await http().post(BOOKING).send(payload).expect(401);
      await http().post(BOOKING).set('Cookie', admin).send(payload).expect(403);
    });
  });

  describe('GET /api/flight-bookings/:id (FLT-21)', () => {
    it('returns the flight, passenger and baggage summary with the payable total', async () => {
      await setBaggagePolicy(3000, 2);
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10, 0, 0, 45000);
      const created = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [
            {
              fullName: 'Adult Passenger',
              dateOfBirth: '2078-12-01',
              passportOrIdNumber: 'P1234567',
              extraBags: [{ weightKg: 20 }],
            },
          ],
        })
        .expect(201);

      const summary = await http()
        .get(`${BOOKING}/${created.body.id}`)
        .set('Cookie', traveler)
        .expect(200);
      const payable = await bookingProvider.getPayable(
        created.body.id as string,
        travelerId,
      );

      expect(payable).not.toBeNull();
      expect(summary.body).toMatchObject({
        id: created.body.id,
        flight: {
          id: flightId,
          flightNumber: 'MS777',
          departureAirport: 'CAI',
          arrivalAirport: 'JFK',
        },
        cabinClass: 'ECONOMY',
        passengerCounts: { adults: 1, children: 0, infants: 0 },
        passengers: [
          {
            fullName: 'Adult Passenger',
            dateOfBirth: '2078-12-01',
            passengerType: 'ADULT',
            extraBags: [{ weightKg: 20 }],
            baggageFeeCents: 3000,
          },
        ],
        baggageFeeCents: 3000,
        totalCents: 48000,
        currency: 'USD',
        status: 'PENDING_PAYMENT',
      });
      expect(summary.body.totalCents).toBe(payable?.amountCents);
      expect(summary.body.passengers[0]).not.toHaveProperty(
        'passportOrIdNumber',
      );
      expect(summary.body).not.toHaveProperty('bookingReference');
      expect(summary.body).not.toHaveProperty('refund');
      expect(summary.body.holdExpiresAt).not.toBeNull();
    });

    it('allows only the booking owner to view the summary', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const bookingId = await hold(flightId);

      await http()
        .get(`${BOOKING}/${bookingId}`)
        .set('Cookie', otherTraveler)
        .expect(404);
      await http().get(`${BOOKING}/${bookingId}`).expect(401);
      await http()
        .get(`${BOOKING}/${bookingId}`)
        .set('Cookie', admin)
        .expect(403);
    });

    it('returns 404 for malformed or unknown booking ids', async () => {
      await http()
        .get(`${BOOKING}/not-an-id`)
        .set('Cookie', traveler)
        .expect(404);
      await http()
        .get(`${BOOKING}/${new Types.ObjectId().toString()}`)
        .set('Cookie', traveler)
        .expect(404);
    });

    it('lets the owner read back a confirmed one-way booking with its reference', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const bookingId = await hold(flightId);
      await lifecycle.confirmPaid(
        BookingType.FLIGHT,
        bookingId,
        'pi_summary_one_way',
      );
      const stored = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(bookingId) });
      expect(stored?.bookingReference).toMatch(/^FLT-[0-9A-F]{16}$/);

      const details = await http()
        .get(`${BOOKING}/${bookingId}`)
        .set('Cookie', traveler)
        .expect(200);

      expect(details.body).toMatchObject({
        id: bookingId,
        status: 'CONFIRMED',
        bookingReference: stored?.bookingReference,
        holdExpiresAt: null,
        cabinClass: 'ECONOMY',
        passengerCounts: { adults: 1, children: 0, infants: 0 },
        currency: 'USD',
        totalCents: 45000,
        refund: null,
      });
      expect(details.body.flight).toMatchObject({
        id: flightId,
        flightNumber: 'MS777',
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
      });
      expect(details.body.segments).toHaveLength(1);
      expect(details.body.segments[0]).toMatchObject({
        flightId,
        cabinClass: 'ECONOMY',
        flight: {
          id: flightId,
          flightNumber: 'MS777',
          departureAirport: 'CAI',
          arrivalAirport: 'JFK',
        },
      });
      expect(details.body.passengers).toEqual([]);
    });

    it('lets the owner read back both segments of a confirmed round trip', async () => {
      const outboundId = await createFlight();
      const returnId = await createFlight(
        {
          flightNumber: 'BB778',
          departureAirport: 'JFK',
          arrivalAirport: 'CAI',
          departureLocalTime: '2090-12-02T10:00',
          arrivalLocalTime: '2090-12-02T18:30',
        },
        returnModerator,
      );
      await addCabin(outboundId, 'ECONOMY', 10);
      await addCabin(returnId, 'BUSINESS', 10);
      const created = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          segments: [
            { flightId: outboundId, cabinClass: 'ECONOMY' },
            { flightId: returnId, cabinClass: 'BUSINESS' },
          ],
          passengers: [
            {
              fullName: 'Amina Example',
              dateOfBirth: '2078-12-01',
              passportOrIdNumber: 'P1234567',
            },
          ],
        })
        .expect(201);
      const bookingId = created.body.id as string;
      await lifecycle.confirmPaid(
        BookingType.FLIGHT,
        bookingId,
        'pi_summary_round_trip',
      );

      const details = await http()
        .get(`${BOOKING}/${bookingId}`)
        .set('Cookie', traveler)
        .expect(200);

      expect(details.body.status).toBe('CONFIRMED');
      expect(details.body.bookingReference).toMatch(/^FLT-[0-9A-F]{16}$/);
      expect(details.body.holdExpiresAt).toBeNull();
      expect(details.body.refund).toBeNull();
      expect(details.body.segments).toHaveLength(2);
      const segments = details.body.segments as Array<{
        flightId: string;
        cabinClass: string;
        flight: { flightNumber: string };
      }>;
      expect(segments.map((segment) => segment.flightId)).toEqual([
        outboundId,
        returnId,
      ]);
      expect(segments.map((segment) => segment.cabinClass)).toEqual([
        'ECONOMY',
        'BUSINESS',
      ]);
      expect(segments.map((segment) => segment.flight.flightNumber)).toEqual([
        'MS777',
        'BB778',
      ]);
      expect(details.body.passengers[0]).toMatchObject({
        fullName: 'Amina Example',
        passengerType: 'ADULT',
      });
      expect(details.body.passengers[0]).not.toHaveProperty(
        'passportOrIdNumber',
      );
    });

    it("shows the latest refund through PAY-03's getLatestForBooking contract", async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10, 0, 0, 45000);
      const bookingId = await hold(flightId);
      await lifecycle.confirmPaid(
        BookingType.FLIGHT,
        bookingId,
        'pi_summary_refund',
      );
      await connection.collection('refunds').insertMany([
        {
          bookingType: 'FLIGHT',
          bookingId: new Types.ObjectId(bookingId),
          userId: new Types.ObjectId(travelerId),
          stripePaymentIntentId: 'pi_summary_refund',
          stripeRefundId: 're_summary_older',
          amountCents: 10000,
          currency: 'USD',
          status: 'PENDING',
          createdAt: new Date('2026-11-18T09:00:00.000Z'),
          updatedAt: new Date('2026-11-18T09:00:00.000Z'),
        },
        {
          bookingType: 'FLIGHT',
          bookingId: new Types.ObjectId(bookingId),
          userId: new Types.ObjectId(travelerId),
          stripePaymentIntentId: 'pi_summary_refund_2',
          stripeRefundId: 're_summary_latest',
          amountCents: 45000,
          currency: 'USD',
          status: 'REFUNDED',
          reason: 'Cancelled per tier 2',
          createdAt: new Date('2026-11-18T10:00:00.000Z'),
          updatedAt: new Date('2026-11-18T10:00:00.000Z'),
        },
      ]);

      const details = await http()
        .get(`${BOOKING}/${bookingId}`)
        .set('Cookie', traveler)
        .expect(200);

      expect(details.body.refund).toMatchObject({
        bookingType: 'FLIGHT',
        bookingId,
        status: 'REFUNDED',
        amountCents: 45000,
        currency: 'USD',
        reason: 'Cancelled per tier 2',
        createdAt: '2026-11-18T10:00:00.000Z',
      });
      expect(details.body.refund).not.toHaveProperty('stripeRefundId');
      expect(details.body.refund).not.toHaveProperty('stripePaymentIntentId');
      expect(details.body.refund).not.toHaveProperty('userId');
    });

    it('hides a confirmed booking from another traveler', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const bookingId = await hold(flightId);
      await lifecycle.confirmPaid(
        BookingType.FLIGHT,
        bookingId,
        'pi_summary_other',
      );

      await http()
        .get(`${BOOKING}/${bookingId}`)
        .set('Cookie', otherTraveler)
        .expect(404);
      await http().get(`${BOOKING}/${bookingId}`).expect(401);
    });

    it('lazily expires an overdue hold before returning the summary', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const created = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [
            {
              fullName: 'Adult Passenger',
              dateOfBirth: '2078-12-01',
              passportOrIdNumber: 'P1234567',
            },
          ],
        })
        .expect(201);
      await expireNow(created.body.id);

      await http()
        .get(`${BOOKING}/${created.body.id}`)
        .set('Cookie', traveler)
        .expect(409);

      const stored = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(created.body.id) });
      expect(stored?.status).toBe(BookingStatus.EXPIRED);
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
    });

    it('publishes the summary route and response schema in Swagger', async () => {
      const docs = await http().get('/api/docs-json').expect(200);
      expect(
        docs.body.paths['/api/flight-bookings/{id}'].get.responses['200'],
      ).toBeDefined();
      expect(docs.body.paths['/api/flight-bookings/{id}'].get.operationId).toBe(
        'FlightBookingsController_getSummary',
      );
    });
  });

  describe('GET /api/flight-bookings (FLT-25)', () => {
    /** A legacy confirmed booking inserted straight into the collection (no FLT-19 passengers). */
    function legacyBooking(overrides: Record<string, unknown> = {}) {
      return {
        userId: new Types.ObjectId(travelerId),
        airlineId: new Types.ObjectId(airline.id),
        cabinClass: 'ECONOMY',
        passengerCounts: { adults: 1, children: 0, infants: 0 },
        seats: 1,
        farePerPassengerCents: 45000,
        infantFareCents: 4500,
        totalCents: 45000,
        baggageFeeCents: 0,
        currency: 'USD',
        status: 'CONFIRMED',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
      };
    }

    /** Moves a flight into the past without going through the (rejecting) create endpoint. */
    async function moveFlightToPast(flightId: string) {
      await connection.collection('flights').updateOne(
        { _id: new Types.ObjectId(flightId) },
        {
          $set: {
            departureAt: new Date('2020-01-01T00:00:00.000Z'),
            arrivalAt: new Date('2020-01-01T05:00:00.000Z'),
          },
        },
      );
    }

    it('groups a traveler\'s bookings into Upcoming, Past and Cancelled, cancellation winning over the date', async () => {
      const upcomingFlight = await createFlight({ flightNumber: 'MS801' });
      await addCabin(upcomingFlight, 'ECONOMY', 10);
      const upcomingBooking = await hold(upcomingFlight);

      const pastFlight = await createFlight({ flightNumber: 'MS802' });
      await addCabin(pastFlight, 'ECONOMY', 10);
      const pastBooking = await hold(pastFlight);
      await moveFlightToPast(pastFlight);

      const cancelledFlight = await createFlight({ flightNumber: 'MS803' });
      await addCabin(cancelledFlight, 'ECONOMY', 10);
      const cancelledBooking = await hold(cancelledFlight);
      await lifecycle.confirmPaid(
        BookingType.FLIGHT,
        cancelledBooking,
        'pi_list_cancelled',
      );
      await lifecycle.transition(
        BookingType.FLIGHT,
        cancelledBooking,
        BookingStatus.CANCELLED,
      );

      const res = await http()
        .get(BOOKING)
        .set('Cookie', traveler)
        .expect(200);

      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
      const items = res.body.items as Array<{
        id: string;
        group: string;
        status: string;
        cabinClass: string;
        bookingReference?: string;
      }>;
      const byId = new Map(items.map((item) => [item.id, item]));
      expect(byId.get(upcomingBooking)?.group).toBe('UPCOMING');
      expect(byId.get(pastBooking)?.group).toBe('PAST');
      expect(byId.get(cancelledBooking)?.group).toBe('CANCELLED');
      expect(byId.get(cancelledBooking)?.status).toBe('CANCELLED');
      expect(byId.get(cancelledBooking)?.cabinClass).toBe('ECONOMY');
      expect(byId.get(cancelledBooking)?.bookingReference).toMatch(
        /^FLT-[0-9A-F]{16}$/,
      );

      const past = await http()
        .get(`${BOOKING}?group=PAST`)
        .set('Cookie', traveler)
        .expect(200);
      expect(past.body.total).toBe(1);
      expect(past.body.items.map((item: { id: string }) => item.id)).toEqual([
        pastBooking,
      ]);
    });

    it('groups a round trip by its outbound segment and returns both segments', async () => {
      const outboundId = await createFlight({ flightNumber: 'MS811' });
      const returnId = await createFlight(
        {
          flightNumber: 'BB812',
          departureAirport: 'JFK',
          arrivalAirport: 'CAI',
          departureLocalTime: '2090-12-02T10:00',
          arrivalLocalTime: '2090-12-02T18:30',
        },
        returnModerator,
      );
      await addCabin(outboundId, 'ECONOMY', 10);
      await addCabin(returnId, 'ECONOMY', 10);
      const created = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          segments: [
            { flightId: outboundId, cabinClass: 'ECONOMY' },
            { flightId: returnId, cabinClass: 'ECONOMY' },
          ],
          passengers: [
            {
              fullName: 'Amina Example',
              dateOfBirth: '2078-12-01',
              passportOrIdNumber: 'P1234567',
            },
          ],
        })
        .expect(201);

      // Only the return leg is in the past: the trip must still be UPCOMING (outbound decides).
      await moveFlightToPast(returnId);

      const res = await http()
        .get(BOOKING)
        .set('Cookie', traveler)
        .expect(200);
      const [item] = res.body.items as Array<{
        id: string;
        group: string;
        bookingReference?: string;
        flight: { id: string; flightNumber: string };
        segments: Array<{
          flightId: string;
          flight: { flightNumber: string };
        }>;
        passengers: Array<Record<string, unknown>>;
      }>;
      expect(item.id).toBe(created.body.id);
      expect(item.group).toBe('UPCOMING');
      expect(item.flight.id).toBe(outboundId);
      expect(item.segments.map((segment) => segment.flightId)).toEqual([
        outboundId,
        returnId,
      ]);
      expect(
        item.segments.map((segment) => segment.flight.flightNumber),
      ).toEqual(['MS811', 'BB812']);
      expect(item.passengers).toHaveLength(1);
      expect(item.passengers[0]).not.toHaveProperty('passportOrIdNumber');
    });

    it('lists a legacy one-way booking without segments and without a reference', async () => {
      const flightId = await createFlight({ flightNumber: 'MS821' });
      const legacyId = new Types.ObjectId();
      await connection.collection('flightBookings').insertOne({
        _id: legacyId,
        flightId: new Types.ObjectId(flightId),
        ...legacyBooking(),
      });

      const res = await http()
        .get(BOOKING)
        .set('Cookie', traveler)
        .expect(200);
      const [item] = res.body.items as Array<{
        id: string;
        group: string;
        bookingReference?: string;
        segments: Array<{ flightId: string }>;
        passengers: unknown[];
      }>;
      expect(item.id).toBe(legacyId.toString());
      expect(item.group).toBe('UPCOMING');
      expect(item).not.toHaveProperty('bookingReference');
      expect(item.segments).toHaveLength(1);
      expect(item.segments[0].flightId).toBe(flightId);
      expect(item.passengers).toEqual([]);
    });

    it('returns only the caller\'s bookings and keeps details owner-only', async () => {
      const flightId = await createFlight({ flightNumber: 'MS831' });
      await addCabin(flightId, 'ECONOMY', 10);
      const mine = await hold(flightId);
      const theirs = (
        await http()
          .post(HOLD)
          .set('Cookie', otherTraveler)
          .send(body(flightId))
          .expect(201)
      ).body.id as string;

      const mineList = await http()
        .get(BOOKING)
        .set('Cookie', traveler)
        .expect(200);
      expect(mineList.body.total).toBe(1);
      expect(mineList.body.items.map((item: { id: string }) => item.id)).toEqual([
        mine,
      ]);

      const theirList = await http()
        .get(BOOKING)
        .set('Cookie', otherTraveler)
        .expect(200);
      expect(theirList.body.total).toBe(1);
      expect(
        theirList.body.items.map((item: { id: string }) => item.id),
      ).toEqual([theirs]);

      await http()
        .get(`${BOOKING}/${theirs}`)
        .set('Cookie', traveler)
        .expect(404);
    });

    it('paginates with page size 10 by default, explicit pages, stable totals and an empty out-of-range page', async () => {
      const flightId = await createFlight({ flightNumber: 'MS841' });
      const docs = Array.from({ length: 12 }, (_, index) => ({
        _id: new Types.ObjectId(),
        flightId: new Types.ObjectId(flightId),
        ...legacyBooking({
          createdAt: new Date(Date.UTC(2026, 10, 1, 10, index)),
          updatedAt: new Date(Date.UTC(2026, 10, 1, 10, index)),
        }),
      }));
      await connection.collection('flightBookings').insertMany(docs);

      const first = await http()
        .get(BOOKING)
        .set('Cookie', traveler)
        .expect(200);
      expect(first.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      expect(first.body.items).toHaveLength(10);
      // Newest first: the 12th inserted document (10:11) is the first row.
      expect(first.body.items[0].id).toBe(docs[11]._id.toString());

      const repeated = await http()
        .get(BOOKING)
        .set('Cookie', traveler)
        .expect(200);
      expect(repeated.body.items.map((item: { id: string }) => item.id)).toEqual(
        first.body.items.map((item: { id: string }) => item.id),
      );

      const second = await http()
        .get(`${BOOKING}?page=2&limit=10`)
        .set('Cookie', traveler)
        .expect(200);
      expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([
        docs[1]._id.toString(),
        docs[0]._id.toString(),
      ]);

      const empty = await http()
        .get(`${BOOKING}?page=3&limit=10`)
        .set('Cookie', traveler)
        .expect(200);
      expect(empty.body).toMatchObject({
        items: [],
        page: 3,
        limit: 10,
        total: 12,
        totalPages: 2,
      });

      const single = await http()
        .get(`${BOOKING}?page=1&limit=1`)
        .set('Cookie', traveler)
        .expect(200);
      expect(single.body).toMatchObject({ limit: 1, total: 12, totalPages: 12 });
      expect(single.body.items).toHaveLength(1);

      await http().get(`${BOOKING}?page=0`).set('Cookie', traveler).expect(400);
      await http()
        .get(`${BOOKING}?limit=51`)
        .set('Cookie', traveler)
        .expect(400);
      await http()
        .get(`${BOOKING}?group=LATER`)
        .set('Cookie', traveler)
        .expect(400);
    });

    it('requires the traveler role and publishes the list contract in Swagger', async () => {
      await http().get(BOOKING).set('Cookie', admin).expect(403);
      await http().get(BOOKING).expect(401);

      const docs = await http().get('/api/docs-json').expect(200);
      const operation = docs.body.paths['/api/flight-bookings'].get;
      expect(operation.operationId).toBe('FlightBookingsController_listMine');
      expect(
        operation.parameters.map((parameter: { name: string }) => parameter.name),
      ).toEqual(expect.arrayContaining(['page', 'limit', 'group']));
      const ok = operation.responses['200'].content['application/json'].schema;
      expect(ok.required).toEqual(
        expect.arrayContaining([
          'items',
          'page',
          'limit',
          'total',
          'totalPages',
        ]),
      );
      expect(ok.properties.items.type).toBe('array');
      expect(ok.properties.page).toMatchObject({ type: 'integer', example: 1 });
      expect(ok.properties.limit).toMatchObject({
        type: 'integer',
        example: 10,
      });
      expect(operation.responses['400']).toBeDefined();
      expect(operation.responses['403']).toBeDefined();
    });
  });

  describe('GET /api/flight-bookings/:id/e-ticket (FLT-23)', () => {
    const ticketPassenger = (fullName: string, passportOrIdNumber: string) => ({
      fullName,
      dateOfBirth: '2078-12-01',
      passportOrIdNumber,
    });

    async function createConfirmedOneWay(
      flightOverrides: Record<string, unknown> = {},
    ) {
      const flightId = await createFlight(flightOverrides);
      await addCabin(flightId, 'ECONOMY', 10);
      const created = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          flightId,
          cabinClass: 'ECONOMY',
          passengers: [ticketPassenger('Amina Example', 'P1234567')],
        })
        .expect(201);
      const id = created.body.id as string;
      await lifecycle.confirmPaid(BookingType.FLIGHT, id, 'pi_eticket_one_way');
      const stored = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(id) });
      return { id, flightId, reference: stored?.bookingReference as string };
    }

    async function createConfirmedRoundTrip() {
      const outboundId = await createFlight();
      const returnId = await createFlight(
        {
          flightNumber: 'BB778',
          departureAirport: 'JFK',
          arrivalAirport: 'CAI',
          departureLocalTime: '2090-12-02T10:00',
          arrivalLocalTime: '2090-12-02T18:30',
        },
        returnModerator,
      );
      await addCabin(outboundId, 'ECONOMY', 10);
      await addCabin(returnId, 'BUSINESS', 10);
      const created = await http()
        .post(BOOKING)
        .set('Cookie', traveler)
        .send({
          segments: [
            { flightId: outboundId, cabinClass: 'ECONOMY' },
            { flightId: returnId, cabinClass: 'BUSINESS' },
          ],
          passengers: [ticketPassenger('Amina Example', 'P1234567')],
        })
        .expect(201);
      const id = created.body.id as string;
      await lifecycle.confirmPaid(
        BookingType.FLIGHT,
        id,
        'pi_eticket_round_trip',
      );
      return { id, outboundId, returnId };
    }

    const download = (id: string, cookie = traveler) =>
      http().get(`${BOOKING}/${id}/e-ticket`).set('Cookie', cookie);

    it('returns a downloadable PDF for the owner, named after the reference', async () => {
      const { id, reference } = await createConfirmedOneWay();
      const res = await download(id).expect(200);

      expect(res.headers['content-type']).toMatch(/^application\/pdf/);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="e-ticket-${reference}.pdf"`,
      );
      const pdf = res.body as Buffer;
      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1')).toContain('%%EOF');
      expect(pdf.length).toBeGreaterThan(500);
      expect(reference).toMatch(/^FLT-[0-9A-F]{16}$/);
    });

    it('represents both booked segments in a round-trip e-ticket', async () => {
      const { id, outboundId, returnId } = await createConfirmedRoundTrip();
      const buildSpy = jest.spyOn(etickets, 'buildData');

      const res = await download(id).expect(200);

      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(buildSpy).toHaveBeenCalledTimes(1);
      const [, flights] = buildSpy.mock.calls[0];
      expect(flights.map((flight) => flight._id.toString())).toEqual([
        outboundId,
        returnId,
      ]);
      expect(flights.map((flight) => flight.flightNumber)).toEqual([
        'MS777',
        'BB778',
      ]);
    });

    it("hides another traveler's ticket and requires the traveler role", async () => {
      const { id } = await createConfirmedOneWay();

      await download(id, otherTraveler).expect(404);
      await download(id, admin).expect(403);
      await http().get(`${BOOKING}/${id}/e-ticket`).expect(401);
    });

    it('returns 404 for unknown or malformed booking ids', async () => {
      await download(new Types.ObjectId().toString()).expect(404);
      await download('not-an-object-id').expect(404);
    });

    it('returns 409 while pending and for a historical confirmed booking with no reference', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const pendingId = await hold(flightId);
      await download(pendingId).expect(409);

      const { id } = await createConfirmedOneWay({ flightNumber: 'MS779' });
      await connection
        .collection('flightBookings')
        .updateOne(
          { _id: new Types.ObjectId(id) },
          { $unset: { bookingReference: '' } },
        );
      await download(id).expect(409);
    });

    it('documents the PDF response and ownership/eligibility errors', async () => {
      const docs = await http().get('/api/docs-json').expect(200);
      const operation =
        docs.body.paths['/api/flight-bookings/{id}/e-ticket'].get;

      expect(
        operation.responses['200'].content['application/pdf'],
      ).toBeDefined();
      expect(operation.responses['403']).toBeDefined();
      expect(operation.responses['404']).toBeDefined();
      expect(operation.responses['409']).toBeDefined();
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

    it('confirming a paid booking turns held seats into booked seats, once, and assigns one reference', async () => {
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
      expect(stored?.bookingReference).toMatch(/^FLT-[0-9A-F]{16}$/);
      const reference = stored?.bookingReference;
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
      const repeated = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(id) });
      expect(repeated?.bookingReference).toBe(reference);
      expect(repeated?.paymentRef).toBe('pi_test_1');
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

    it('a different payment reference cannot overwrite the original reference', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const id = await hold(flightId);
      await lifecycle.confirmPaid(BookingType.FLIGHT, id, 'pi_test_1');
      const before = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(id) });

      await expect(
        lifecycle.confirmPaid(BookingType.FLIGHT, id, 'pi_other'),
      ).rejects.toThrow();

      const after = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(id) });
      expect(after?.paymentRef).toBe('pi_test_1');
      expect(after?.bookingReference).toBe(before?.bookingReference);
      expect(await cabinOf(flightId)).toMatchObject({
        heldSeats: 0,
        bookedSeats: 1,
      });
    });

    it('the late-paid expiry path confirms a flight booking without a Stripe event object', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 'ECONOMY', 10);
      const id = await hold(flightId, { adults: 2 });
      await expireNow(id);
      nextPrepareExpiry = { outcome: 'PAID', paymentRef: 'pi_late_paid' };

      await expect(lifecycle.expireIfDue(BookingType.FLIGHT, id)).resolves.toBe(
        true,
      );

      const stored = await connection
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(id) });
      expect(stored).toMatchObject({
        status: 'CONFIRMED',
        paymentRef: 'pi_late_paid',
      });
      expect(stored?.bookingReference).toMatch(/^FLT-[0-9A-F]{16}$/);
      expect(stored?.holdExpiresAt).toBeUndefined();
      expect(await cabinOf(flightId)).toMatchObject({
        heldSeats: 0,
        bookedSeats: 2,
      });
      expect(
        await connection
          .collection('notifications')
          .countDocuments({ type: 'BOOKING_CONFIRMED' }),
      ).toBe(1);
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
