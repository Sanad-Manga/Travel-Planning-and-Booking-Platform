import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AirlinesModule } from '../src/airlines';
import { AuthModule } from '../src/auth/auth.module';
import { Role } from '../src/common';
import configuration from '../src/config/configuration';
import { FlightsModule } from '../src/flights';
import { FlightStatusJob } from '../src/flights/flight-status.job';
import { ReferenceDataModule } from '../src/reference-data/reference-data.module';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

describe('flight status (FLT-30) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let modCookie: string;
  let airlineId: Types.ObjectId;

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

  /** Seeds a flight straight into the database (the create endpoint refuses past departures). */
  async function seedFlight(
    flightNumber: string,
    departureAt: Date,
    status = 'SCHEDULED',
  ) {
    const _id = new Types.ObjectId();
    await connection.collection('flights').insertOne({
      _id,
      airlineId,
      flightNumber,
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 3_600_000),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/New_York',
      departureLocalDate: departureAt.toISOString().slice(0, 10),
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const cabinId = new Types.ObjectId();
    await connection.collection('cabins').insertOne({
      _id: cabinId,
      flightId: _id,
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
    return { id: _id.toString(), cabinId: cabinId.toString() };
  }

  const storedStatus = async (id: string) =>
    (
      await connection
        .collection('flights')
        .findOne({ _id: new Types.ObjectId(id) })
    )?.status;

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
    ]);
    const admin = await loginAs('admin@example.com', { role: Role.ADMIN });
    const airline = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline A', code: 'AA' })
        .expect(201)
    ).body as { id: string };
    airlineId = new Types.ObjectId(airline.id);
    modCookie = await loginAs('moda@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId,
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('GET /api/flights/:id reads a past SCHEDULED flight as DEPARTED before the job runs', async () => {
    const { id } = await seedFlight('PAST1', new Date('2020-01-01T10:00:00Z'));

    const res = await http().get(`/api/flights/${id}`).expect(200);

    expect(res.body.status).toBe('DEPARTED');
    expect(await storedStatus(id)).toBe('SCHEDULED'); // the job has not run
  });

  it('GET /api/flights/:id keeps a future flight SCHEDULED and shows CANCELLED as stored', async () => {
    const future = await seedFlight('FUT1', new Date('2090-01-01T10:00:00Z'));
    const cancelled = await seedFlight(
      'CXL1',
      new Date('2020-01-02T10:00:00Z'),
      'CANCELLED',
    );

    expect((await http().get(`/api/flights/${future.id}`)).body.status).toBe(
      'SCHEDULED',
    );
    expect((await http().get(`/api/flights/${cancelled.id}`)).body.status).toBe(
      'CANCELLED',
    );
  });

  it('search finds only the future SCHEDULED flight, never a departed or cancelled one', async () => {
    await seedFlight('SRCH-PAST', new Date('2020-03-01T10:00:00Z'));
    await seedFlight('SRCH-CXL', new Date('2090-03-01T11:00:00Z'), 'CANCELLED');
    await seedFlight('SRCH-OK', new Date('2090-03-01T12:00:00Z'));

    const res = await http()
      .get('/api/flights/search')
      .query({
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureDate: '2090-03-01',
        passengers: 1,
      })
      .expect(200);
    const past = await http()
      .get('/api/flights/search')
      .query({
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureDate: '2020-03-01',
        passengers: 1,
      })
      .expect(200);

    expect(
      res.body.items.map((f: { flightNumber: string }) => f.flightNumber),
    ).toEqual(['SRCH-OK']);
    expect(past.body.items).toEqual([]);
  });

  it('a departed flight cannot be edited (409), a scheduled one still can', async () => {
    const past = await seedFlight(
      'EDIT-PAST',
      new Date('2020-04-01T10:00:00Z'),
    );
    const future = await seedFlight(
      'EDIT-OK',
      new Date('2090-04-01T10:00:00Z'),
    );

    await http()
      .patch(`/api/flights/${past.id}/cabins/${past.cabinId}`)
      .set('Cookie', modCookie)
      .send({ priceCents: 50000 })
      .expect(409);
    await http()
      .patch(`/api/flights/${future.id}/cabins/${future.cabinId}`)
      .set('Cookie', modCookie)
      .send({ priceCents: 50000 })
      .expect(200);
  });

  it('the job stores DEPARTED for past flights and leaves the rest alone', async () => {
    const past = await seedFlight('JOB-PAST', new Date('2020-05-01T10:00:00Z'));
    const future = await seedFlight(
      'JOB-FUT',
      new Date('2090-05-01T10:00:00Z'),
    );

    await app.get(FlightStatusJob).markDeparted();

    expect(await storedStatus(past.id)).toBe('DEPARTED');
    expect(await storedStatus(future.id)).toBe('SCHEDULED');
  });
});
