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
import { BookingStatus, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { FlightsModule } from '../src/flights';
import { NotificationsModule } from '../src/notifications';
import { PaymentsModule, STRIPE_GATEWAY } from '../src/payments';
import { FakeStripeGateway } from '../src/payments/fake-stripe-gateway';
import { ReferenceDataModule } from '../src/reference-data/reference-data.module';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/** FLT-29: a moderator's read-only view of a flight's bookings, and the passenger CSV. */
describe('flight bookings view and passenger CSV (FLT-29) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const LIST = (id: string) => `/api/flights/${id}/bookings`;
  const EXPORT = (id: string) => `/api/flights/${id}/passengers/export`;

  let traveler: string;
  let moderator: string;
  let otherModerator: string;
  let airline: { id: string };
  let otherAirline: { id: string };
  let travelerId: string;
  let flightId: string;

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
    flightNumber: string,
    cookie = moderator,
  ): Promise<string> {
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
    return res.body.id as string;
  }

  const passenger = (fullName: string, type = 'ADULT') => ({
    fullName,
    dateOfBirth: '1990-01-01',
    passportOrIdNumber: 'SECRET-PASSPORT-123',
    passengerType: type,
    extraBags: [],
    baggageFeeCents: 0,
  });

  let clock = 0;
  async function seedBooking(
    flight: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const _id = new Types.ObjectId();
    const created = new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock));
    await db.collection('flightBookings').insertOne({
      _id,
      userId: new Types.ObjectId(travelerId),
      airlineId: new Types.ObjectId(airline.id),
      flightId: new Types.ObjectId(flight),
      cabinClass: 'ECONOMY',
      passengerCounts: { adults: 1, children: 0, infants: 0 },
      seats: 1,
      farePerPassengerCents: 45000,
      infantFareCents: 0,
      totalCents: 45000,
      baggageFeeCents: 0,
      currency: 'USD',
      status: BookingStatus.CONFIRMED,
      createdAt: created,
      updatedAt: created,
      ...overrides,
    });
    return _id.toString();
  }

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
      .overrideProvider(STRIPE_GATEWAY)
      .useValue(new FakeStripeGateway())
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.listen(0, '127.0.0.1');
    db = app.get<Connection>(getConnectionToken());
    await db.model('User').init();
    await db.model('Airline').init();
    await db.model('Flight').init();

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
    const admin = await loginAs('admin@example.com', { role: Role.ADMIN });
    traveler = await loginAs('traveler@example.com');
    travelerId = (await db
      .collection('users')
      .findOne({ email: 'traveler@example.com' }))!._id.toString();
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

  beforeEach(async () => {
    flightId = await createFlight('MS900');
  });

  afterEach(async () => {
    await Promise.all(
      ['flights', 'cabins', 'flightBookings'].map((name) =>
        db.collection(name).deleteMany({}),
      ),
    );
  });

  describe.each([
    ['GET /api/flights/:id/bookings', LIST],
    ['GET /api/flights/:id/passengers/export', EXPORT],
  ])('%s access rules', (_name, url) => {
    it('needs login (401), a moderator (403) and the owning airline (403)', async () => {
      await http().get(url(flightId)).expect(401);
      await http().get(url(flightId)).set('Cookie', traveler).expect(403);
      await http().get(url(flightId)).set('Cookie', otherModerator).expect(403);
    });

    it('answers 404 for an unknown flight and 400 for a malformed id', async () => {
      await http()
        .get(url(new Types.ObjectId().toString()))
        .set('Cookie', moderator)
        .expect(404);
      await http().get(url('nope')).set('Cookie', moderator).expect(400);
    });
  });

  describe('GET /api/flights/:id/bookings', () => {
    it('lists reference, passenger names, cabin, seats and status, leaving out unpaid holds, expired holds and other flights', async () => {
      const confirmed = await seedBooking(flightId, {
        bookingReference: 'FLT-AAAAAAAAAAAA',
        seats: 2,
        passengerCounts: { adults: 2, children: 0, infants: 0 },
        passengers: [passenger('Sara Hassan'), passenger('Omar Hassan')],
      });
      const cancelled = await seedBooking(flightId, {
        bookingReference: 'FLT-BBBBBBBBBBBB',
        status: BookingStatus.CANCELLED,
        cabinClass: 'BUSINESS',
        passengers: [passenger('Lina Said')],
      });
      await seedBooking(flightId, { status: BookingStatus.PENDING_PAYMENT });
      await seedBooking(flightId, { status: BookingStatus.EXPIRED });
      const elsewhere = await createFlight('MS901');
      await seedBooking(elsewhere, { bookingReference: 'FLT-ELSEWHERE' });

      const res = await http()
        .get(LIST(flightId))
        .set('Cookie', moderator)
        .expect(200);

      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      // Newest first.
      expect(res.body.items.map((b: { id: string }) => b.id)).toEqual([
        cancelled,
        confirmed,
      ]);
      expect(res.body.items[1]).toEqual({
        id: confirmed,
        bookingReference: 'FLT-AAAAAAAAAAAA',
        status: 'CONFIRMED',
        cabinClass: 'ECONOMY',
        seats: 2,
        cabinSeatsRemaining: 0,
        passengers: [
          { fullName: 'Sara Hassan', passengerType: 'ADULT' },
          { fullName: 'Omar Hassan', passengerType: 'ADULT' },
        ],
      });
      expect(res.body.items[0]).toMatchObject({
        status: 'CANCELLED',
        cabinClass: 'BUSINESS',
      });
      // Identity documents never leave the API.
      expect(JSON.stringify(res.body)).not.toContain('SECRET-PASSPORT');
    });

    it('shows a legacy booking without passengers or a reference, with empty passengers', async () => {
      await seedBooking(flightId);
      const res = await http()
        .get(LIST(flightId))
        .set('Cookie', moderator)
        .expect(200);
      expect(res.body.items[0].passengers).toEqual([]);
      expect(res.body.items[0]).not.toHaveProperty('bookingReference');
    });

    it('shows the leg on this flight when it is the return leg of a round trip', async () => {
      const outbound = await createFlight('BB100', otherModerator);
      const segment = (flight: string, cabinClass: string, seats: number) => ({
        flightId: new Types.ObjectId(flight),
        airlineId: new Types.ObjectId(airline.id),
        cabinClass,
        seats,
        farePerPassengerCents: 1,
        infantFareCents: 0,
        baggageFeeCents: 0,
      });
      await seedBooking(outbound, {
        airlineId: new Types.ObjectId(otherAirline.id),
        cabinClass: 'ECONOMY',
        seats: 3,
        segments: [
          segment(outbound, 'ECONOMY', 3),
          segment(flightId, 'FIRST', 1),
        ],
        passengers: [passenger('Round Trip')],
      });
      const res = await http()
        .get(LIST(flightId))
        .set('Cookie', moderator)
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        cabinClass: 'FIRST',
        seats: 1,
      });
    });

    it('paginates and filters by status', async () => {
      for (let i = 0; i < 3; i++) await seedBooking(flightId);
      await seedBooking(flightId, { status: BookingStatus.CANCELLED });

      const page = await http()
        .get(LIST(flightId))
        .query({ page: 2, limit: 3 })
        .set('Cookie', moderator)
        .expect(200);
      expect(page.body).toMatchObject({
        page: 2,
        limit: 3,
        total: 4,
        totalPages: 2,
      });
      expect(page.body.items).toHaveLength(1);

      const onlyCancelled = await http()
        .get(LIST(flightId))
        .query({ status: 'CANCELLED' })
        .set('Cookie', moderator)
        .expect(200);
      expect(onlyCancelled.body.total).toBe(1);

      const bad = await http()
        .get(LIST(flightId))
        .query({ status: 'PENDING_PAYMENT' })
        .set('Cookie', moderator)
        .expect(400);
      expect(bad.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'status' })]),
      );
      await http()
        .get(LIST(flightId))
        .query({ limit: 500 })
        .set('Cookie', moderator)
        .expect(400);
    });

    it('shows seats remaining in the cabin of each row (total - booked - held)', async () => {
      await db.collection('cabins').insertMany([
        {
          flightId: new Types.ObjectId(flightId),
          cabinClass: 'ECONOMY',
          totalSeats: 10,
          bookedSeats: 3,
          heldSeats: 2,
          priceCents: 45000,
          freeBags: 1,
          maxBagWeightKg: 23,
        },
        {
          flightId: new Types.ObjectId(flightId),
          cabinClass: 'BUSINESS',
          totalSeats: 4,
          bookedSeats: 4,
          heldSeats: 0,
          priceCents: 90000,
          freeBags: 2,
          maxBagWeightKg: 32,
        },
      ]);
      await seedBooking(flightId, { cabinClass: 'ECONOMY' });
      await seedBooking(flightId, { cabinClass: 'BUSINESS' });
      const res = await http()
        .get(LIST(flightId))
        .set('Cookie', moderator)
        .expect(200);
      const bySeats = Object.fromEntries(
        res.body.items.map(
          (b: { cabinClass: string; cabinSeatsRemaining: number }) => [
            b.cabinClass,
            b.cabinSeatsRemaining,
          ],
        ),
      );
      expect(bySeats).toEqual({ ECONOMY: 5, BUSINESS: 0 });
    });

    it('still works for a CANCELLED flight', async () => {
      await db
        .collection('flights')
        .updateOne(
          { _id: new Types.ObjectId(flightId) },
          { $set: { status: 'CANCELLED' } },
        );
      await http().get(LIST(flightId)).set('Cookie', moderator).expect(200);
    });
  });

  describe('GET /api/flights/:id/passengers/export', () => {
    it('downloads a CSV with a header row, escaped values and only the flying passengers', async () => {
      await seedBooking(flightId, {
        bookingReference: 'FLT-AAAAAAAAAAAA',
        seats: 3,
        passengers: [
          passenger('Hassan, Sara'),
          passenger('Omar "Ozzy" Hassan'),
          passenger('=HYPERLINK("http://evil")', 'CHILD'),
        ],
      });
      await seedBooking(flightId, {
        bookingReference: 'FLT-LEGACYLEGACY',
        status: BookingStatus.COMPLETED,
      });
      await seedBooking(flightId, {
        bookingReference: 'FLT-CANCELLED0000',
        status: BookingStatus.CANCELLED,
        passengers: [passenger('Cancelled Person')],
      });
      await seedBooking(flightId, {
        status: BookingStatus.PENDING_PAYMENT,
        passengers: [passenger('Unpaid Person')],
      });

      const res = await http()
        .get(EXPORT(flightId))
        .set('Cookie', moderator)
        .buffer(true)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="flight-MS900-passengers.csv"',
      );
      const lines = res.text.split('\r\n').filter((l) => l !== '');
      expect(lines[0]).toBe(
        'bookingReference,bookingStatus,passengerName,passengerType,cabinClass,seats',
      );
      expect(lines).toContain(
        'FLT-AAAAAAAAAAAA,CONFIRMED,"Hassan, Sara",ADULT,ECONOMY,3',
      );
      expect(lines).toContain(
        'FLT-AAAAAAAAAAAA,CONFIRMED,"Omar ""Ozzy"" Hassan",ADULT,ECONOMY,3',
      );
      // A value a spreadsheet would run as a formula is neutralised.
      const formula = lines.find((l) => l.includes('HYPERLINK'))!;
      expect(formula).toContain(`"'=HYPERLINK(""http://evil"")"`);
      // A legacy booking keeps a row with an empty name.
      expect(lines).toContain('FLT-LEGACYLEGACY,COMPLETED,,,ECONOMY,1');
      expect(res.text).not.toContain('Cancelled Person');
      expect(res.text).not.toContain('Unpaid Person');
      expect(res.text).not.toContain('SECRET-PASSPORT');
      expect(lines).toHaveLength(5); // header + 3 passengers + 1 legacy row
    });

    it('returns just the header row for a flight nobody has booked', async () => {
      const res = await http()
        .get(EXPORT(flightId))
        .set('Cookie', moderator)
        .buffer(true)
        .expect(200);
      expect(res.text.trim()).toBe(
        'bookingReference,bookingStatus,passengerName,passengerType,cabinClass,seats',
      );
    });
  });

  it('publishes both routes in Swagger', async () => {
    const docs = await http().get('/api/docs-json').expect(200);
    const list = docs.body.paths['/api/flights/{id}/bookings']?.get;
    const csv = docs.body.paths['/api/flights/{id}/passengers/export']?.get;
    expect(list).toBeDefined();
    expect(csv?.responses['200'].content).toHaveProperty('text/csv');
    for (const operation of [list, csv]) {
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '404']),
      );
    }
  });
});
