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
import { ReferenceDataModule } from '../src/reference-data/reference-data.module';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

describe('flights (FLT-03) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());

  /** Inserts a user straight into MongoDB (registration never creates admins or moderators), then logs in. */
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

  // Far in the future so the "departure in the past" rule never trips on the real clock.
  const valid = () => ({
    flightNumber: 'MS777',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureLocalTime: '2090-12-01T14:30',
    arrivalLocalTime: '2090-12-01T19:45',
  });

  let admin: string;
  let user: string;
  let hotelMod: string;
  let modOfA: string;
  let modOfB: string;
  let airlineA: { id: string };
  let airlineB: { id: string };

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
    await connection.model('Flight').init(); // unique index

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
    user = await loginAs('user@example.com');
    airlineA = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline A', code: 'AA' })
        .expect(201)
    ).body;
    airlineB = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline B', code: 'BB' })
        .expect(201)
    ).body;
    modOfA = await loginAs('moda@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(airlineA.id),
    });
    modOfB = await loginAs('modb@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(airlineB.id),
    });
    hotelMod = await loginAs('hotel@example.com', {
      role: Role.HOTEL_MODERATOR,
      hotelId: new Types.ObjectId(),
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  afterEach(async () => {
    await connection.collection('flights').deleteMany({});
  });

  describe('POST /api/flights', () => {
    it('moderator creates a flight: 201, UTC times, zones, DTO without _id/__v', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send(valid())
        .expect(201);
      expect(res.body).toMatchObject({
        airlineId: airlineA.id,
        flightNumber: 'MS777',
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureAt: '2090-12-01T12:30:00.000Z',
        arrivalAt: '2090-12-02T00:45:00.000Z',
        departureTimeZone: 'Africa/Cairo',
        arrivalTimeZone: 'America/New_York',
        status: 'SCHEDULED',
      });
      expect(res.body.id).toMatch(/^[0-9a-f]{24}$/);
      expect(res.body._id).toBeUndefined();
      expect(res.body.__v).toBeUndefined();
    });

    it('normalises flight number and airport codes (trim, upper-case)', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({
          ...valid(),
          flightNumber: ' ms777 ',
          departureAirport: 'cai',
          arrivalAirport: ' jfk',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        flightNumber: 'MS777',
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
      });
    });

    it('the airline comes from the login: an airlineId in the body is rejected, not obeyed', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({ ...valid(), airlineId: airlineB.id })
        .expect(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'airlineId' }),
        ]),
      );
      expect(await connection.collection('flights').countDocuments()).toBe(0);
    });

    it('rejects client-controlled server fields (status, UTC times)', async () => {
      await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({ ...valid(), status: 'DEPARTED' })
        .expect(400);
      await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({ ...valid(), departureAt: '2090-12-01T00:00:00Z' })
        .expect(400);
    });

    it('rejects an offset or Z on the local times', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({ ...valid(), departureLocalTime: '2090-12-01T14:30:00Z' })
        .expect(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'departureLocalTime' }),
      ]);
    });

    it('rejects missing and badly typed fields with a field-level detail each', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({ flightNumber: 7 })
        .expect(400);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          'flightNumber',
          'departureAirport',
          'arrivalAirport',
          'departureLocalTime',
          'arrivalLocalTime',
        ]),
      );
    });

    it('identical airports: 400 on arrivalAirport', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({ ...valid(), arrivalAirport: 'CAI' })
        .expect(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'arrivalAirport' }),
        ]),
      );
    });

    it('arrival not after departure (UTC): 400 on arrivalLocalTime', async () => {
      // 14:30 Cairo = 12:30Z; 07:00 New York = 12:00Z
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({ ...valid(), arrivalLocalTime: '2090-12-01T07:00' })
        .expect(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'arrivalLocalTime' }),
      ]);
    });

    it('departure in the past: 400 on departureLocalTime', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({
          ...valid(),
          departureLocalTime: '2020-12-01T14:30',
          arrivalLocalTime: '2020-12-01T19:45',
        })
        .expect(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'departureLocalTime' }),
      ]);
    });

    it('airport outside the seeded list: 400 on that field', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({ ...valid(), arrivalAirport: 'ZZZ' })
        .expect(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'arrivalAirport' }),
      ]);
    });

    it('duplicate flight number for the same airline and date: 409, other airline is fine', async () => {
      await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send(valid())
        .expect(201);
      const dup = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send(valid())
        .expect(409);
      expect(dup.body.details).toEqual([
        expect.objectContaining({ field: 'flightNumber' }),
      ]);
      await http()
        .post('/api/flights')
        .set('Cookie', modOfB)
        .send(valid())
        .expect(201);
    });

    it('a moderator can only create for their own airline', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfB)
        .send(valid())
        .expect(201);
      expect(res.body.airlineId).toBe(airlineB.id);
    });

    it.each([
      ['user', () => user],
      ['admin', () => admin],
      ['hotel moderator', () => hotelMod],
    ])('%s gets 403', async (_name, cookie) => {
      await http()
        .post('/api/flights')
        .set('Cookie', cookie())
        .send(valid())
        .expect(403);
    });

    it('not logged in: 401', async () => {
      await http().post('/api/flights').send(valid()).expect(401);
    });

    it('errors use the contract shape', async () => {
      const res = await http()
        .post('/api/flights')
        .set('Cookie', modOfA)
        .send({})
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        path: '/api/flights',
      });
      expect(typeof res.body.timestamp).toBe('string');
    });
  });
});
