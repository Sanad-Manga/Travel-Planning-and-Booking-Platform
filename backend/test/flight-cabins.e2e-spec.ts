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

describe('flight cabins (FLT-04) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

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

  const economy = () => ({
    cabinClass: 'ECONOMY',
    totalSeats: 180,
    priceCents: 45000,
    freeBags: 1,
    maxBagWeightKg: 23,
  });

  let admin: string;
  let user: string;
  let modOfA: string;
  let modOfB: string;
  let flightA: string; // flight of airline A
  let flightB: string; // flight of airline B

  async function createFlight(cookie: string, flightNumber: string) {
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
    await connection.model('Cabin').init(); // unique index flight + class

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
    const airlineA = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline A', code: 'AA' })
        .expect(201)
    ).body;
    const airlineB = (
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
    flightA = await createFlight(modOfA, 'AA100');
    flightB = await createFlight(modOfB, 'BB100');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  afterEach(async () => {
    await connection.collection('cabins').deleteMany({});
    await connection
      .collection('flights')
      .updateMany({}, { $set: { status: 'SCHEDULED' } });
  });

  const post = (flightId: string, cookie: string, body: unknown) =>
    http()
      .post(`/api/flights/${flightId}/cabins`)
      .set('Cookie', cookie)
      .send(body as object);
  const patch = (
    flightId: string,
    cabinId: string,
    cookie: string,
    body: unknown,
  ) =>
    http()
      .patch(`/api/flights/${flightId}/cabins/${cabinId}`)
      .set('Cookie', cookie)
      .send(body as object);

  describe('POST /api/flights/:id/cabins', () => {
    it('creates a cabin: 201, counters start at 0, price in cents, available seats', async () => {
      const res = await post(flightA, modOfA, economy()).expect(201);
      expect(res.body).toMatchObject({
        flightId: flightA,
        cabinClass: 'ECONOMY',
        totalSeats: 180,
        bookedSeats: 0,
        heldSeats: 0,
        availableSeats: 180,
        priceCents: 45000,
        currency: 'USD',
        freeBags: 1,
        maxBagWeightKg: 23,
      });
      expect(res.body.id).toMatch(/^[0-9a-f]{24}$/);
      expect(res.body._id).toBeUndefined();
      expect(res.body.__v).toBeUndefined();
      const stored = await connection.collection('cabins').findOne({});
      expect(stored!.priceCents).toBe(45000);
      expect(Number.isInteger(stored!.priceCents)).toBe(true);
    });

    it('allows all four classes on one flight', async () => {
      for (const cabinClass of [
        'ECONOMY',
        'PREMIUM_ECONOMY',
        'BUSINESS',
        'FIRST',
      ]) {
        await post(flightA, modOfA, { ...economy(), cabinClass }).expect(201);
      }
      expect(await connection.collection('cabins').countDocuments()).toBe(4);
    });

    it('accepts 0 free bags', async () => {
      await post(flightA, modOfA, { ...economy(), freeBags: 0 }).expect(201);
    });

    it.each([
      ['a class outside the four', { cabinClass: 'LUXURY' }, 'cabinClass'],
      ['a lower-case class', { cabinClass: 'economy' }, 'cabinClass'],
      ['0 seats', { totalSeats: 0 }, 'totalSeats'],
      ['negative seats', { totalSeats: -5 }, 'totalSeats'],
      ['fractional seats', { totalSeats: 10.5 }, 'totalSeats'],
      ['seats as text', { totalSeats: '10' }, 'totalSeats'],
      ['price 0', { priceCents: 0 }, 'priceCents'],
      ['negative price', { priceCents: -100 }, 'priceCents'],
      ['fractional cents', { priceCents: 100.5 }, 'priceCents'],
      ['negative free bags', { freeBags: -1 }, 'freeBags'],
      ['fractional free bags', { freeBags: 1.5 }, 'freeBags'],
      ['0 kg per bag', { maxBagWeightKg: 0 }, 'maxBagWeightKg'],
      ['negative kg', { maxBagWeightKg: -3 }, 'maxBagWeightKg'],
    ])('rejects %s with a field-level 400', async (_label, override, field) => {
      const res = await post(flightA, modOfA, {
        ...economy(),
        ...override,
      }).expect(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
      expect(await connection.collection('cabins').countDocuments()).toBe(0);
    });

    it('rejects missing fields and unknown fields (booked/held counters are not client-controlled)', async () => {
      const missing = await post(flightA, modOfA, {}).expect(400);
      expect(
        missing.body.details.map((d: { field: string }) => d.field),
      ).toEqual(
        expect.arrayContaining([
          'cabinClass',
          'totalSeats',
          'priceCents',
          'freeBags',
          'maxBagWeightKg',
        ]),
      );
      await post(flightA, modOfA, { ...economy(), bookedSeats: 5 }).expect(400);
      await post(flightA, modOfA, { ...economy(), heldSeats: 5 }).expect(400);
      await post(flightA, modOfA, { ...economy(), flightId: flightB }).expect(
        400,
      );
    });

    it('a duplicate class on the same flight is 409 on cabinClass; another flight is fine', async () => {
      await post(flightA, modOfA, economy()).expect(201);
      const dup = await post(flightA, modOfA, {
        ...economy(),
        totalSeats: 50,
      }).expect(409);
      expect(dup.body.details).toEqual([
        expect.objectContaining({ field: 'cabinClass' }),
      ]);
      await post(flightB, modOfB, economy()).expect(201);
    });

    it('two simultaneous requests for the same class create exactly one cabin', async () => {
      const results = await Promise.all([
        post(flightA, modOfA, economy()),
        post(flightA, modOfA, economy()),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await connection.collection('cabins').countDocuments()).toBe(1);
    });

    it("another airline's moderator gets 403 and nothing is created", async () => {
      await post(flightA, modOfB, economy()).expect(403);
      expect(await connection.collection('cabins').countDocuments()).toBe(0);
    });

    it.each([
      ['user', () => user],
      ['admin', () => admin],
    ])('%s gets 403', async (_name, cookie) => {
      await post(flightA, cookie(), economy()).expect(403);
    });

    it('not logged in: 401', async () => {
      await http()
        .post(`/api/flights/${flightA}/cabins`)
        .send(economy())
        .expect(401);
    });

    it('unknown or malformed flight id: 404 / 400', async () => {
      await post(new Types.ObjectId().toString(), modOfA, economy()).expect(
        404,
      );
      await post('not-an-id', modOfA, economy()).expect(400);
    });

    it('a cancelled or departed flight cannot get cabins: 409', async () => {
      for (const status of ['CANCELLED', 'DEPARTED']) {
        await connection
          .collection('flights')
          .updateOne(
            { _id: new Types.ObjectId(flightA) },
            { $set: { status } },
          );
        await post(flightA, modOfA, economy()).expect(409);
      }
    });
  });

  describe('PATCH /api/flights/:id/cabins/:cabinId', () => {
    let cabinId: string;
    beforeEach(async () => {
      cabinId = (await post(flightA, modOfA, economy()).expect(201)).body.id;
    });

    it('edits seats, price and baggage; class stays', async () => {
      const res = await patch(flightA, cabinId, modOfA, {
        totalSeats: 200,
        priceCents: 39900,
        freeBags: 2,
        maxBagWeightKg: 32,
      }).expect(200);
      expect(res.body).toMatchObject({
        id: cabinId,
        cabinClass: 'ECONOMY',
        totalSeats: 200,
        priceCents: 39900,
        freeBags: 2,
        maxBagWeightKg: 32,
        availableSeats: 200,
      });
    });

    it('a partial edit leaves the other fields alone', async () => {
      const res = await patch(flightA, cabinId, modOfA, {
        priceCents: 50000,
      }).expect(200);
      expect(res.body).toMatchObject({
        priceCents: 50000,
        totalSeats: 180,
        freeBags: 1,
      });
    });

    it('does not touch booked or held counters', async () => {
      await connection
        .collection('cabins')
        .updateOne(
          { _id: new Types.ObjectId(cabinId) },
          { $set: { bookedSeats: 7, heldSeats: 3 } },
        );
      const res = await patch(flightA, cabinId, modOfA, {
        priceCents: 1000,
      }).expect(200);
      expect(res.body).toMatchObject({
        bookedSeats: 7,
        heldSeats: 3,
        availableSeats: 170,
      });
    });

    it('cannot lower seats below booked + held (409); exactly booked + held is fine', async () => {
      await connection
        .collection('cabins')
        .updateOne(
          { _id: new Types.ObjectId(cabinId) },
          { $set: { bookedSeats: 100, heldSeats: 20 } },
        );
      const refused = await patch(flightA, cabinId, modOfA, {
        totalSeats: 119,
      }).expect(409);
      expect(refused.body.details).toEqual([
        expect.objectContaining({ field: 'totalSeats' }),
      ]);
      expect(
        (await connection.collection('cabins').findOne({}))!.totalSeats,
      ).toBe(180);
      const ok = await patch(flightA, cabinId, modOfA, {
        totalSeats: 120,
      }).expect(200);
      expect(ok.body.availableSeats).toBe(0);
    });

    it.each([
      [{ totalSeats: 0 }, 'totalSeats'],
      [{ priceCents: 0 }, 'priceCents'],
      [{ priceCents: -1 }, 'priceCents'],
      [{ freeBags: -1 }, 'freeBags'],
      [{ maxBagWeightKg: 0 }, 'maxBagWeightKg'],
    ])('rejects %j', async (body, field) => {
      const res = await patch(flightA, cabinId, modOfA, body).expect(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    });

    it('rejects an empty body, a class change and counter fields', async () => {
      await patch(flightA, cabinId, modOfA, {}).expect(400);
      await patch(flightA, cabinId, modOfA, { cabinClass: 'FIRST' }).expect(
        400,
      );
      await patch(flightA, cabinId, modOfA, { bookedSeats: 0 }).expect(400);
    });

    it("another airline's moderator gets 403 and the cabin is unchanged", async () => {
      await patch(flightA, cabinId, modOfB, { priceCents: 1 }).expect(403);
      expect(
        (await connection.collection('cabins').findOne({}))!.priceCents,
      ).toBe(45000);
    });

    it('user and admin get 403, no cookie 401', async () => {
      await patch(flightA, cabinId, user, { priceCents: 1 }).expect(403);
      await patch(flightA, cabinId, admin, { priceCents: 1 }).expect(403);
      await http()
        .patch(`/api/flights/${flightA}/cabins/${cabinId}`)
        .send({ priceCents: 1 })
        .expect(401);
    });

    it('a cabin id that belongs to another flight is 404', async () => {
      const otherCabin = (await post(flightB, modOfB, economy()).expect(201))
        .body.id;
      await patch(flightA, otherCabin, modOfA, { priceCents: 1 }).expect(404);
      await patch(flightA, new Types.ObjectId().toString(), modOfA, {
        priceCents: 1,
      }).expect(404);
      await patch(flightA, 'not-an-id', modOfA, { priceCents: 1 }).expect(400);
    });

    it('a departed flight cannot be edited: 409', async () => {
      await connection
        .collection('flights')
        .updateOne(
          { _id: new Types.ObjectId(flightA) },
          { $set: { status: 'DEPARTED' } },
        );
      await patch(flightA, cabinId, modOfA, { priceCents: 1 }).expect(409);
    });
  });
});
