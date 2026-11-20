import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AirlinesModule } from '../src/airlines';
import { AuthModule } from '../src/auth/auth.module';
import { Role } from '../src/common';
import configuration from '../src/config/configuration';
import { FlightsModule } from '../src/flights';
import { FlightBooking } from '../src/flights/schemas/flight-booking.schema';
import { ReferenceDataModule } from '../src/reference-data/reference-data.module';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

describe('edit flight (FLT-05) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let modCookie: string;
  let otherModCookie: string;
  let travelerCookie: string;
  let airlineId: Types.ObjectId;
  let flightCounter = 0;

  const PASSWORD = 'Passw0rdOK';
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

  /** A SCHEDULED CAI -> JFK flight in 2090 with one ECONOMY cabin, seeded straight into the database. */
  async function seedFlight(overrides: Record<string, unknown> = {}) {
    const id = new Types.ObjectId();
    const departureAt = new Date('2090-12-01T12:30:00Z'); // 14:30 in Cairo
    await connection.collection('flights').insertOne({
      _id: id,
      airlineId,
      flightNumber: `MS${100 + flightCounter++}`,
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt,
      arrivalAt: new Date('2090-12-02T00:45:00Z'), // 19:45 in New York
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/New_York',
      departureLocalDate: '2090-12-01',
      status: 'SCHEDULED',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    const cabinId = new Types.ObjectId();
    await connection.collection('cabins').insertOne({
      _id: cabinId,
      flightId: id,
      cabinClass: 'ECONOMY',
      totalSeats: 100,
      bookedSeats: 0,
      heldSeats: 0,
      priceCents: 45000,
      freeBags: 1,
      maxBagWeightKg: 23,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { id: id.toString(), cabinId: cabinId.toString() };
  }

  async function seedBooking(
    flightId: string,
    userId: Types.ObjectId,
    status: string,
    farePerPassengerCents = 45000,
  ) {
    const _id = new Types.ObjectId();
    await connection.collection('flightBookings').insertOne({
      _id,
      userId,
      airlineId,
      flightId: new Types.ObjectId(flightId),
      cabinClass: 'ECONOMY',
      seats: 1,
      farePerPassengerCents,
      totalCents: farePerPassengerCents,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return _id;
  }

  /**
   * A round-trip booking: it stores only its OUTBOUND flight in `flightId`; the return leg exists only in
   * `segments`. `returnFlightId` is the flight under test, so this booking reaches it through its second segment.
   */
  async function seedReturnLegBooking(
    returnFlightId: string,
    userId: Types.ObjectId,
    status: string,
  ) {
    const _id = new Types.ObjectId();
    const outboundFlightId = new Types.ObjectId();
    const segment = (flightId: Types.ObjectId) => ({
      flightId,
      airlineId,
      cabinClass: 'ECONOMY',
      seats: 1,
      farePerPassengerCents: 45000,
      infantFareCents: 0,
      baggageFeeCents: 0,
    });
    await connection.collection('flightBookings').insertOne({
      _id,
      userId,
      airlineId,
      flightId: outboundFlightId,
      segments: [
        segment(outboundFlightId),
        segment(new Types.ObjectId(returnFlightId)),
      ],
      cabinClass: 'ECONOMY',
      seats: 1,
      farePerPassengerCents: 45000,
      totalCents: 90000,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return _id;
  }

  const stored = (id: string) =>
    connection.collection('flights').findOne({ _id: new Types.ObjectId(id) });
  const notificationsOf = (userId: Types.ObjectId) =>
    connection
      .collection('notifications')
      .find({ userId, type: 'FLIGHT_SCHEDULE_CHANGED' })
      .toArray();
  const patch = (
    id: string,
    body: Record<string, unknown>,
    cookie = modCookie,
  ) => http().patch(`/api/flights/${id}`).set('Cookie', cookie).send(body);

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
        AirlinesModule,
        ReferenceDataModule,
        FlightsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();
    await connection.model('Airline').init();
    await connection.model('Flight').init();

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
      {
        iata_code: 'LHR',
        name: 'Heathrow',
        city_id: 'c3',
        country_code: 'GB',
        time_zone: 'Europe/London',
      },
    ]);
    const admin = await loginAs('admin@example.com', { role: Role.ADMIN });
    const createAirline = async (name: string, code: string) =>
      (
        await http()
          .post('/api/airlines')
          .set('Cookie', admin)
          .send({ name, code })
          .expect(201)
      ).body as { id: string };
    const a = await createAirline('Airline A', 'AA');
    const b = await createAirline('Airline B', 'BB');
    airlineId = new Types.ObjectId(a.id);
    modCookie = await loginAs('moda@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId,
    });
    otherModCookie = await loginAs('modb@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(b.id),
    });
    travelerCookie = await loginAs('traveler@example.com');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('times', () => {
    it('edits both times: local times are read in each airport zone and stored in UTC', async () => {
      const { id } = await seedFlight();

      const res = await patch(id, {
        departureLocalTime: '2090-12-01T16:00',
        arrivalLocalTime: '2090-12-01T21:15',
      }).expect(200);

      expect(res.body).toMatchObject({
        id,
        departureAt: '2090-12-01T14:00:00.000Z',
        arrivalAt: '2090-12-02T02:15:00.000Z',
        departureLocal: '2090-12-01T16:00:00+02:00',
        arrivalLocal: '2090-12-01T21:15:00-05:00',
        status: 'SCHEDULED',
      });
      expect((await stored(id))?.departureLocalDate).toBe('2090-12-01');
    });

    it('editing only the departure keeps the stored arrival', async () => {
      const { id } = await seedFlight();

      const res = await patch(id, {
        departureLocalTime: '2090-12-01T10:00',
      }).expect(200);

      expect(res.body.departureAt).toBe('2090-12-01T08:00:00.000Z');
      expect(res.body.arrivalAt).toBe('2090-12-02T00:45:00.000Z');
    });

    it('moving both times to another day updates the stored local departure date', async () => {
      const { id } = await seedFlight();

      await patch(id, {
        departureLocalTime: '2090-12-05T10:00',
        arrivalLocalTime: '2090-12-05T15:00',
      }).expect(200);

      expect((await stored(id))?.departureLocalDate).toBe('2090-12-05');
    });

    it('rejects an arrival that is not after the departure (compared in UTC), with every error at once', async () => {
      const { id } = await seedFlight();

      const res = await patch(id, {
        departureLocalTime: '2090-12-02T10:00',
      }).expect(400);

      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'arrivalLocalTime' }),
      ]);
      expect((await stored(id))?.departureAt).toEqual(
        new Date('2090-12-01T12:30:00Z'),
      );
    });

    it('rejects a departure in the past and a malformed time with field-level details', async () => {
      const { id } = await seedFlight();

      const past = await patch(id, {
        departureLocalTime: '2020-01-01T10:00',
      }).expect(400);
      const bad = await patch(id, {
        departureLocalTime: 'tomorrow',
        arrivalLocalTime: '2090-12-01',
      }).expect(400);

      expect(
        past.body.details.map((d: { field: string }) => d.field),
      ).toContain('departureLocalTime');
      expect(bad.body.details.map((d: { field: string }) => d.field)).toEqual(
        expect.arrayContaining(['departureLocalTime', 'arrivalLocalTime']),
      );
    });

    it('an empty body, an unknown field and the flight number are 400', async () => {
      const { id } = await seedFlight();

      await patch(id, {}).expect(400);
      await patch(id, { flightNumber: 'MS999' }).expect(400);
      await patch(id, { status: 'CANCELLED' }).expect(400);
    });
  });

  describe('who and which flights', () => {
    it('only the owning airline moderator: another airline gets 403, a traveler 403, a guest 401', async () => {
      const { id } = await seedFlight();
      const body = { departureLocalTime: '2090-12-01T16:00' };

      await patch(id, body, otherModCookie).expect(403);
      await patch(id, body, travelerCookie).expect(403);
      await http().patch(`/api/flights/${id}`).send(body).expect(401);
      expect((await stored(id))?.departureAt).toEqual(
        new Date('2090-12-01T12:30:00Z'),
      );
    });

    it('unknown flight is 404 and a malformed id is 400', async () => {
      const body = { departureLocalTime: '2090-12-01T16:00' };

      await patch(new Types.ObjectId().toString(), body).expect(404);
      await patch('not-an-id', body).expect(400);
    });

    it.each(['CANCELLED', 'DEPARTED'])(
      'a %s flight cannot be edited: 409',
      async (status) => {
        const { id } = await seedFlight({ status });
        await patch(id, { departureLocalTime: '2090-12-01T16:00' }).expect(409);
      },
    );

    it('a flight past its departure time cannot be edited even while the stored status is still SCHEDULED', async () => {
      const { id } = await seedFlight({
        departureAt: new Date('2020-01-01T10:00:00Z'),
        arrivalAt: new Date('2020-01-01T20:00:00Z'),
        departureLocalDate: '2020-01-01',
      });

      const res = await patch(id, {
        arrivalLocalTime: '2090-12-01T21:15',
      }).expect(409);

      expect(res.body.message).toContain('DEPARTED');
    });
  });

  describe('airports', () => {
    it('can change while the flight has no booking', async () => {
      const { id } = await seedFlight();

      const res = await patch(id, { arrivalAirport: 'LHR' }).expect(200);

      expect(res.body).toMatchObject({
        arrivalAirport: 'LHR',
        arrivalTimeZone: 'Europe/London',
        departureAirport: 'CAI',
      });
    });

    it('an unknown airport or the same airport twice is a 400', async () => {
      const { id } = await seedFlight();

      const unknown = await patch(id, { arrivalAirport: 'ZZZ' }).expect(400);
      const same = await patch(id, { arrivalAirport: 'CAI' }).expect(400);

      expect(unknown.body.details[0].field).toBe('arrivalAirport');
      expect(same.body.details[0].field).toBe('arrivalAirport');
    });

    it.each(['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED'])(
      'are locked once a %s booking exists: 409, nothing changes',
      async (status) => {
        const { id } = await seedFlight();
        await seedBooking(id, new Types.ObjectId(), status);

        const res = await patch(id, { arrivalAirport: 'LHR' }).expect(409);

        expect(res.body.details[0].field).toBe('departureAirport');
        expect((await stored(id))?.arrivalAirport).toBe('JFK');
      },
    );

    it('a booking that holds this flight as the RETURN leg of a round trip locks the airports too', async () => {
      const { id } = await seedFlight();
      await seedReturnLegBooking(id, new Types.ObjectId(), 'CONFIRMED');

      await patch(id, { arrivalAirport: 'LHR' }).expect(409);

      expect((await stored(id))?.arrivalAirport).toBe('JFK');
    });

    it('an expired or cancelled booking does not lock them', async () => {
      const { id } = await seedFlight();
      await seedBooking(id, new Types.ObjectId(), 'EXPIRED');
      await seedBooking(id, new Types.ObjectId(), 'CANCELLED');

      await patch(id, { arrivalAirport: 'LHR' }).expect(200);
    });

    it('a booking that is held while the airports are being written undoes the change (409, route as before)', async () => {
      const { id } = await seedFlight();
      const bookings = app.get<Model<FlightBooking>>(
        getModelToken(FlightBooking.name),
      );
      // First check (before the write): no booking. Second check (after the write): a hold has just landed.
      const exists = jest
        .spyOn(bookings, 'exists')
        .mockReturnValueOnce(Promise.resolve(null) as never)
        .mockReturnValueOnce(
          Promise.resolve({ _id: new Types.ObjectId() }) as never,
        );
      try {
        await patch(id, { arrivalAirport: 'LHR' }).expect(409);
      } finally {
        exists.mockRestore();
      }

      expect(await stored(id)).toMatchObject({
        arrivalAirport: 'JFK',
        arrivalTimeZone: 'America/New_York',
      });
    });

    it('times can still change on a booked flight', async () => {
      const { id } = await seedFlight();
      await seedBooking(id, new Types.ObjectId(), 'CONFIRMED');

      await patch(id, { departureLocalTime: '2090-12-01T16:00' }).expect(200);
    });
  });

  describe('notifications', () => {
    it('a time change notifies each passenger with a CONFIRMED booking once, and nobody else', async () => {
      const { id } = await seedFlight();
      const confirmedTwice = new Types.ObjectId();
      const confirmedOnce = new Types.ObjectId();
      const pending = new Types.ObjectId();
      const cancelled = new Types.ObjectId();
      const firstBooking = await seedBooking(id, confirmedTwice, 'CONFIRMED');
      await seedBooking(id, confirmedTwice, 'CONFIRMED');
      await seedBooking(id, confirmedOnce, 'CONFIRMED');
      await seedBooking(id, pending, 'PENDING_PAYMENT');
      await seedBooking(id, cancelled, 'CANCELLED');

      await patch(id, { departureLocalTime: '2090-12-01T16:00' }).expect(200);

      const twice = await notificationsOf(confirmedTwice);
      expect(twice).toHaveLength(1);
      expect(twice[0]).toMatchObject({
        link: `/flight-bookings/${firstBooking.toString()}`,
      });
      expect(twice[0].message).toContain('2090-12-01T16:00:00+02:00');
      expect(await notificationsOf(confirmedOnce)).toHaveLength(1);
      expect(await notificationsOf(pending)).toHaveLength(0);
      expect(await notificationsOf(cancelled)).toHaveLength(0);
    });

    it('a time change also notifies each passenger whose CONFIRMED round trip has this flight as its return leg, once', async () => {
      const { id } = await seedFlight();
      const roundTripper = new Types.ObjectId();
      const pending = new Types.ObjectId();
      const firstBooking = await seedReturnLegBooking(
        id,
        roundTripper,
        'CONFIRMED',
      );
      await seedReturnLegBooking(id, roundTripper, 'CONFIRMED');
      await seedReturnLegBooking(id, pending, 'PENDING_PAYMENT');

      await patch(id, { departureLocalTime: '2090-12-01T16:00' }).expect(200);

      const notes = await notificationsOf(roundTripper);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        link: `/flight-bookings/${firstBooking.toString()}`,
      });
      expect(await notificationsOf(pending)).toHaveLength(0);
    });

    it('an edit that leaves both times as they were sends nothing', async () => {
      const { id } = await seedFlight();
      const passenger = new Types.ObjectId();
      await seedBooking(id, passenger, 'CONFIRMED');

      await patch(id, { departureLocalTime: '2090-12-01T14:30' }).expect(200);

      expect(await notificationsOf(passenger)).toHaveLength(0);
    });

    it('a rejected edit sends nothing', async () => {
      const { id } = await seedFlight();
      const passenger = new Types.ObjectId();
      await seedBooking(id, passenger, 'CONFIRMED');

      await patch(id, { departureLocalTime: '2020-01-01T10:00' }).expect(400);

      expect(await notificationsOf(passenger)).toHaveLength(0);
    });
  });

  describe('cabin prices and seat counts (PATCH /api/flights/:id/cabins/:cabinId)', () => {
    const cabin = (
      id: string,
      cabinId: string,
      body: Record<string, unknown>,
      cookie = modCookie,
    ) =>
      http()
        .patch(`/api/flights/${id}/cabins/${cabinId}`)
        .set('Cookie', cookie)
        .send(body);

    it('seat counts cannot go below booked + held, and can go to exactly that number', async () => {
      const { id, cabinId } = await seedFlight();
      await connection
        .collection('cabins')
        .updateOne(
          { _id: new Types.ObjectId(cabinId) },
          { $set: { bookedSeats: 6, heldSeats: 4 } },
        );

      await cabin(id, cabinId, { totalSeats: 9 }).expect(409);
      const ok = await cabin(id, cabinId, { totalSeats: 10 }).expect(200);

      expect(ok.body.totalSeats).toBe(10);
    });

    it('a price change does not touch existing bookings', async () => {
      const { id, cabinId } = await seedFlight();
      const bookingId = await seedBooking(
        id,
        new Types.ObjectId(),
        'CONFIRMED',
        45000,
      );

      const res = await cabin(id, cabinId, { priceCents: 60000 }).expect(200);

      expect(res.body.priceCents).toBe(60000);
      const booking = await connection
        .collection('flightBookings')
        .findOne({ _id: bookingId });
      expect(booking).toMatchObject({
        farePerPassengerCents: 45000,
        totalCents: 45000,
      });
    });

    it('another airline gets 403, and a non-SCHEDULED flight gets 409', async () => {
      const { id, cabinId } = await seedFlight();
      const departed = await seedFlight({ status: 'DEPARTED' });

      await cabin(id, cabinId, { priceCents: 1000 }, otherModCookie).expect(
        403,
      );
      await cabin(departed.id, departed.cabinId, { priceCents: 1000 }).expect(
        409,
      );
    });
  });

  it('Swagger lists PATCH /api/flights/{id}', async () => {
    const res = await http().get('/api/docs-json').expect(200);
    const operation = res.body.paths['/api/flights/{id}'].patch;
    expect(operation).toBeDefined();
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
  });
});
