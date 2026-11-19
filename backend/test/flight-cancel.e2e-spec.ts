import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AirlinesModule } from '../src/airlines';
import { AuthModule } from '../src/auth/auth.module';
import {
  BookingStatus,
  BookingType,
  PaymentStatus,
  RefundStatus,
  Role,
} from '../src/common';
import configuration from '../src/config/configuration';
import { FlightsModule } from '../src/flights';
import { NotificationsModule } from '../src/notifications';
import {
  BookingLifecycle,
  PAYMENT_ACTIVITY,
  PaymentsModule,
  PrepareExpiryResult,
  STRIPE_GATEWAY,
} from '../src/payments';
import { FakeStripeGateway } from '../src/payments/fake-stripe-gateway';
import { ReferenceDataModule } from '../src/reference-data/reference-data.module';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/** FLT-06: an airline moderator cancels a flight. Needs a replica set (BookingLifecycle uses transactions). */
describe('airline cancels a flight (FLT-06) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;
  let lifecycle: BookingLifecycle;
  let stripe: FakeStripeGateway;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const CANCEL = (id: string) => `/api/flights/${id}/cancel`;

  let nextPrepareExpiry: PrepareExpiryResult = 'EXPIRE';
  const paymentActivity = {
    prepareExpiry: (): Promise<PrepareExpiryResult> =>
      Promise.resolve(nextPrepareExpiry),
  };

  let admin: string;
  let traveler: string;
  let otherTraveler: string;
  let moderator: string;
  let otherModerator: string;
  let airline: { id: string };
  let otherAirline: { id: string };
  let travelerId: string;
  let otherTravelerId: string;
  let paymentSequence = 0;

  async function loginAs(email: string, extra: Record<string, unknown> = {}) {
    await db.collection('users').insertOne({
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

  async function createFlight(
    overrides: Record<string, unknown> = {},
    cookie = moderator,
  ) {
    const res = await http()
      .post('/api/flights')
      .set('Cookie', cookie)
      .send({
        flightNumber: 'MS600',
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureLocalTime: '2090-12-01T14:30',
        arrivalLocalTime: '2090-12-01T19:45',
        ...overrides,
      })
      .expect(201);
    return res.body.id as string;
  }

  async function addCabin(flightId: string, totalSeats = 10) {
    await db.collection('cabins').insertOne({
      flightId: new Types.ObjectId(flightId),
      cabinClass: 'ECONOMY',
      totalSeats,
      bookedSeats: 0,
      heldSeats: 0,
      priceCents: 45000,
      freeBags: 1,
      maxBagWeightKg: 23,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const cabinOf = (flightId: string) =>
    db.collection('cabins').findOne({ flightId: new Types.ObjectId(flightId) });

  async function hold(flightId: string, cookie = traveler, adults = 1) {
    const res = await http()
      .post('/api/flight-bookings/hold')
      .set('Cookie', cookie)
      .send({ flightId, cabinClass: 'ECONOMY', adults })
      .expect(201);
    return res.body.id as string;
  }

  const bookingOf = (id: string) =>
    db.collection('flightBookings').findOne({ _id: new Types.ObjectId(id) });

  async function seedPayment(bookingId: string, userId = travelerId) {
    const booking = await bookingOf(bookingId);
    await db.collection('payments').insertOne({
      bookingType: BookingType.FLIGHT,
      bookingId: new Types.ObjectId(bookingId),
      userId: new Types.ObjectId(userId),
      stripePaymentIntentId: `pi_flt06_${++paymentSequence}`,
      amountCents: booking!.totalCents,
      currency: 'USD',
      status: PaymentStatus.SUCCEEDED,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /** Held, paid and confirmed. `paid: false` leaves out the payment row, so the refund cannot be issued. */
  async function confirmedBooking(
    flightId: string,
    cookie = traveler,
    userId = travelerId,
    paid = true,
  ) {
    const id = await hold(flightId, cookie);
    if (paid) await seedPayment(id, userId);
    await lifecycle.confirmPaid(
      BookingType.FLIGHT,
      id,
      `pi_flt06_ref_${++paymentSequence}`,
    );
    return id;
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';

    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    stripe = new FakeStripeGateway();
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
      .overrideProvider(STRIPE_GATEWAY)
      .useValue(stripe)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.listen(0, '127.0.0.1');
    db = app.get<Connection>(getConnectionToken());
    lifecycle = app.get(BookingLifecycle);
    await db.model('User').init();
    await db.model('Airline').init();
    await db.model('Flight').init();
    await db.model('FlightBooking').init();
    await db.model('Payment').init();
    await db.model('Refund').init();

    await db.collection('airports').insertMany([
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
    travelerId = (await db
      .collection('users')
      .findOne({ email: 'traveler@example.com' }))!._id.toString();
    otherTraveler = await loginAs('other-traveler@example.com');
    otherTravelerId = (await db
      .collection('users')
      .findOne({ email: 'other-traveler@example.com' }))!._id.toString();
    airline = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline A', code: 'AA' })
        .expect(201)
    ).body;
    otherAirline = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline B', code: 'BB' })
        .expect(201)
    ).body;
    moderator = await loginAs('moda@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(airline.id),
    });
    otherModerator = await loginAs('modb@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(otherAirline.id),
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    nextPrepareExpiry = 'EXPIRE';
    stripe.refunds.clear();
    await Promise.all(
      [
        'flights',
        'cabins',
        'flightBookings',
        'payments',
        'refunds',
        'notifications',
      ].map((name) => db.collection(name).deleteMany({})),
    );
  });

  describe('who may cancel, and what it needs', () => {
    it('requires login (401), a moderator (403) and the flight owner (403)', async () => {
      const flightId = await createFlight();
      const confirm = { confirm: true };

      await http().post(CANCEL(flightId)).send(confirm).expect(401);
      await http()
        .post(CANCEL(flightId))
        .set('Cookie', traveler)
        .send(confirm)
        .expect(403);
      await http()
        .post(CANCEL(flightId))
        .set('Cookie', otherModerator)
        .send(confirm)
        .expect(403);

      const stored = await db
        .collection('flights')
        .findOne({ _id: new Types.ObjectId(flightId) });
      expect(stored?.status).toBe('SCHEDULED');
    });

    it('answers 404 for an unknown flight', async () => {
      await http()
        .post(CANCEL(new Types.ObjectId().toString()))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(404);
    });

    it('needs confirm: true and changes nothing without it (400 with a field detail)', async () => {
      const flightId = await createFlight();
      await addCabin(flightId);
      const bookingId = await confirmedBooking(flightId);

      for (const payload of [{}, { confirm: false }, { confirm: 'yes' }]) {
        const res = await http()
          .post(CANCEL(flightId))
          .set('Cookie', moderator)
          .send(payload)
          .expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: 'confirm' }),
          ]),
        );
      }

      expect(
        (
          await db
            .collection('flights')
            .findOne({ _id: new Types.ObjectId(flightId) })
        )?.status,
      ).toBe('SCHEDULED');
      expect((await bookingOf(bookingId))?.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(await db.collection('refunds').countDocuments()).toBe(0);
    });

    it('refuses a flight that has already departed (409) and leaves its bookings alone', async () => {
      const flightId = await createFlight();
      await addCabin(flightId);
      const bookingId = await confirmedBooking(flightId);
      await db
        .collection('flights')
        .updateOne(
          { _id: new Types.ObjectId(flightId) },
          { $set: { departureAt: new Date(Date.now() - 3_600_000) } },
        );

      await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(409);
      expect((await bookingOf(bookingId))?.status).toBe(
        BookingStatus.CONFIRMED,
      );
    });
  });

  describe('cancelling a flight with bookings', () => {
    it('cancels the flight, refunds every confirmed booking in full, releases holds, notifies passengers and hides the flight from search', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 10);
      const first = await confirmedBooking(flightId);
      const second = await confirmedBooking(
        flightId,
        otherTraveler,
        otherTravelerId,
      );
      const pendingHold = await hold(flightId);
      expect(await cabinOf(flightId)).toMatchObject({
        bookedSeats: 2,
        heldSeats: 1,
      });

      const res = await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);

      const totals = [
        (await bookingOf(first))!.totalCents,
        (await bookingOf(second))!.totalCents,
      ];
      expect(res.body).toEqual({
        flightId,
        status: 'CANCELLED',
        bookingsCancelled: 2,
        holdsReleased: 1,
        refundsIssued: 2,
        refundedCents: totals[0] + totals[1],
        passengersNotified: 2,
        complete: true,
        pending: [],
      });

      expect(
        (
          await db
            .collection('flights')
            .findOne({ _id: new Types.ObjectId(flightId) })
        )?.status,
      ).toBe('CANCELLED');
      expect((await bookingOf(first))?.status).toBe(BookingStatus.CANCELLED);
      expect((await bookingOf(second))?.status).toBe(BookingStatus.CANCELLED);
      expect((await bookingOf(pendingHold))?.status).toBe(
        BookingStatus.EXPIRED,
      );
      expect(await cabinOf(flightId)).toMatchObject({
        bookedSeats: 0,
        heldSeats: 0,
      });

      const refunds = await db.collection('refunds').find({}).toArray();
      expect(refunds).toHaveLength(2);
      for (const refund of refunds) {
        expect(refund.status).toBe(RefundStatus.REFUNDED);
        const booking = await bookingOf(refund.bookingId.toString());
        expect(refund.amountCents).toBe(booking!.totalCents); // 100%
      }

      const cancelled = await db
        .collection('notifications')
        .find({ type: 'BOOKING_CANCELLED' })
        .toArray();
      expect(cancelled.map((n) => n.userId.toString()).sort()).toEqual(
        [travelerId, otherTravelerId].sort(),
      );
      expect(cancelled[0].link).toMatch(/^\/flight-bookings\//);

      const search = await http()
        .get('/api/flights/search')
        .query({
          departureAirport: 'CAI',
          arrivalAirport: 'JFK',
          departureDate: '2090-12-01',
          passengers: 1,
        })
        .expect(200);
      expect(JSON.stringify(search.body)).not.toContain(flightId);

      // Nothing new can be booked on it.
      await http()
        .post('/api/flight-bookings/hold')
        .set('Cookie', traveler)
        .send({ flightId, cabinClass: 'ECONOMY', adults: 1 })
        .expect(409);
    });

    it('cancels a flight nobody has booked', async () => {
      const flightId = await createFlight();
      const res = await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        bookingsCancelled: 0,
        refundsIssued: 0,
        complete: true,
      });
    });

    it("does not touch bookings on the airline's other flights", async () => {
      const cancelled = await createFlight({ flightNumber: 'MS601' });
      const kept = await createFlight({ flightNumber: 'MS602' });
      await addCabin(cancelled);
      await addCabin(kept);
      const otherBooking = await confirmedBooking(kept);

      await http()
        .post(CANCEL(cancelled))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);

      expect((await bookingOf(otherBooking))?.status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect(await cabinOf(kept)).toMatchObject({ bookedSeats: 1 });
    });

    it("cancels a round trip as a whole when this flight is its return leg, and returns both legs' seats", async () => {
      const outbound = await createFlight(
        {
          flightNumber: 'BB100',
          departureLocalTime: '2090-11-20T10:00',
          arrivalLocalTime: '2090-11-20T15:00',
        },
        otherModerator,
      );
      const returnLeg = await createFlight({ flightNumber: 'AA200' });
      await addCabin(outbound);
      await addCabin(returnLeg);
      await db
        .collection('cabins')
        .updateMany({}, { $set: { bookedSeats: 1 } });
      const id = new Types.ObjectId();
      const segment = (flightId: string, airlineId: string) => ({
        flightId: new Types.ObjectId(flightId),
        airlineId: new Types.ObjectId(airlineId),
        cabinClass: 'ECONOMY',
        seats: 1,
        farePerPassengerCents: 45000,
        infantFareCents: 0,
        baggageFeeCents: 0,
      });
      await db.collection('flightBookings').insertOne({
        _id: id,
        userId: new Types.ObjectId(travelerId),
        airlineId: new Types.ObjectId(otherAirline.id),
        flightId: new Types.ObjectId(outbound),
        segments: [
          segment(outbound, otherAirline.id),
          segment(returnLeg, airline.id),
        ],
        cabinClass: 'ECONOMY',
        passengerCounts: { adults: 1, children: 0, infants: 0 },
        seats: 1,
        farePerPassengerCents: 45000,
        infantFareCents: 0,
        totalCents: 90000,
        baggageFeeCents: 0,
        currency: 'USD',
        status: BookingStatus.CONFIRMED,
        paymentRef: 'pi_roundtrip',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await seedPayment(id.toString());

      const res = await http()
        .post(CANCEL(returnLeg))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);

      expect(res.body).toMatchObject({
        bookingsCancelled: 1,
        refundsIssued: 1,
        refundedCents: 90000,
        complete: true,
      });
      expect((await bookingOf(id.toString()))?.status).toBe(
        BookingStatus.CANCELLED,
      );
      expect(await cabinOf(outbound)).toMatchObject({ bookedSeats: 0 });
      expect(await cabinOf(returnLeg)).toMatchObject({ bookedSeats: 0 });
    });

    it('confirms a hold whose payment already succeeded, then cancels and refunds it', async () => {
      const flightId = await createFlight();
      await addCabin(flightId);
      const id = await hold(flightId);
      await seedPayment(id);
      nextPrepareExpiry = { outcome: 'PAID', paymentRef: 'pi_late_paid' };

      const res = await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);

      expect(res.body).toMatchObject({
        bookingsCancelled: 1,
        holdsReleased: 0,
        refundsIssued: 1,
        complete: true,
      });
      expect((await bookingOf(id))?.status).toBe(BookingStatus.CANCELLED);
      expect(await cabinOf(flightId)).toMatchObject({
        bookedSeats: 0,
        heldSeats: 0,
      });
    });

    it('leaves a hold with a payment still being processed pending, and releases it on a repeat', async () => {
      const flightId = await createFlight();
      await addCabin(flightId);
      const id = await hold(flightId);
      nextPrepareExpiry = 'SKIP';

      const first = await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);
      expect(first.body.complete).toBe(false);
      expect(first.body.pending).toEqual([
        expect.objectContaining({ bookingId: id }),
      ]);
      expect((await bookingOf(id))?.status).toBe(BookingStatus.PENDING_PAYMENT);

      nextPrepareExpiry = 'EXPIRE';
      const second = await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);
      expect(second.body).toMatchObject({ holdsReleased: 1, complete: true });
      expect((await bookingOf(id))?.status).toBe(BookingStatus.EXPIRED);
      expect(await cabinOf(flightId)).toMatchObject({ heldSeats: 0 });
    });
  });

  describe('bookings that appear while the cancellation runs', () => {
    it('cancels and refunds a booking added after the first read of the bookings on the flight', async () => {
      const flightId = await createFlight();
      await addCabin(flightId, 10);
      const first = await confirmedBooking(flightId);
      const source = (await bookingOf(first))!;

      // While the first booking is being cancelled, a second confirmed (paid) booking lands on the
      // same flight, as a change-flight request that already picked it could do.
      const lateId = new Types.ObjectId();
      const realTransition = lifecycle.transition.bind(lifecycle);
      let injected = false;
      jest
        .spyOn(lifecycle, 'transition')
        .mockImplementation(async (type, id, to) => {
          await realTransition(type, id, to);
          if (injected) return;
          injected = true;
          const { _id, ...rest } = source;
          void _id;
          await db.collection('flightBookings').insertOne({
            ...rest,
            _id: lateId,
            status: BookingStatus.CONFIRMED,
            bookingReference: 'FLT-LATE00000000',
            cancellationRefundCents: undefined,
            cancellationRequestedAt: undefined,
          });
          await db
            .collection('cabins')
            .updateOne(
              { flightId: new Types.ObjectId(flightId) },
              { $inc: { bookedSeats: 1 } },
            );
          await seedPayment(lateId.toString());
        });

      const res = await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);

      expect(res.body).toMatchObject({
        bookingsCancelled: 2,
        refundsIssued: 2,
        passengersNotified: 2,
        complete: true,
        pending: [],
      });
      expect((await bookingOf(lateId.toString()))?.status).toBe(
        BookingStatus.CANCELLED,
      );
      expect(await cabinOf(flightId)).toMatchObject({ bookedSeats: 0 });
      expect(await db.collection('refunds').countDocuments()).toBe(2);
    });
  });

  describe('retrying an unfinished cancellation', () => {
    it('reports a booking whose refund failed, finishes it on a repeat and never refunds anyone twice', async () => {
      const flightId = await createFlight();
      await addCabin(flightId);
      const refunded = await confirmedBooking(flightId);
      const unpaid = await confirmedBooking(
        flightId,
        otherTraveler,
        otherTravelerId,
        false, // no successful payment on record: PAY-03 refuses the refund
      );

      const first = await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);
      expect(first.body).toMatchObject({
        bookingsCancelled: 2,
        refundsIssued: 1,
        passengersNotified: 2,
        complete: false,
      });
      expect(first.body.pending).toEqual([
        expect.objectContaining({ bookingId: unpaid }),
      ]);
      // The booking is cancelled and its seat is back even though the refund is outstanding.
      expect((await bookingOf(unpaid))?.status).toBe(BookingStatus.CANCELLED);
      expect(await cabinOf(flightId)).toMatchObject({ bookedSeats: 0 });

      // The payment shows up; sending the same request again finishes exactly that refund.
      await seedPayment(unpaid, otherTravelerId);
      const second = await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);
      expect(second.body).toMatchObject({
        bookingsCancelled: 0,
        refundsIssued: 1,
        passengersNotified: 0,
        complete: true,
        pending: [],
      });

      const third = await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);
      expect(third.body).toMatchObject({
        refundsIssued: 0,
        refundedCents: 0,
        complete: true,
      });

      const refunds = await db.collection('refunds').find({}).toArray();
      expect(refunds.map((r) => r.bookingId.toString()).sort()).toEqual(
        [refunded, unpaid].sort(),
      );
      // Each passenger heard about the cancellation exactly once.
      expect(
        await db
          .collection('notifications')
          .countDocuments({ type: 'BOOKING_CANCELLED' }),
      ).toBe(2);
    });

    it('still refuses a retry from another airline or a traveler', async () => {
      const flightId = await createFlight();
      await http()
        .post(CANCEL(flightId))
        .set('Cookie', moderator)
        .send({ confirm: true })
        .expect(200);
      await http()
        .post(CANCEL(flightId))
        .set('Cookie', otherModerator)
        .send({ confirm: true })
        .expect(403);
      await http()
        .post(CANCEL(flightId))
        .set('Cookie', traveler)
        .send({ confirm: true })
        .expect(403);
    });
  });

  it('publishes the route in Swagger', async () => {
    const docs = await http().get('/api/docs-json').expect(200);
    const operation = docs.body.paths['/api/flights/{id}/cancel']?.post;
    expect(operation).toBeDefined();
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
  });
});
