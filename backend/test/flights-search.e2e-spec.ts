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

describe('flight search (FLT-11) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const SEARCH = '/api/flights/search';
  const query = (extra: Record<string, string | number> = {}) => ({
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureDate: '2090-12-01',
    passengers: 2,
    ...extra,
  });

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

  const flightBody = (overrides: Record<string, unknown> = {}) => ({
    flightNumber: 'MS777',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureLocalTime: '2090-12-01T14:30',
    arrivalLocalTime: '2090-12-01T19:45',
    ...overrides,
  });

  let modCookie: string;
  let airline: { id: string };

  /** Creates a flight through the real FLT-03 endpoint and returns its id. */
  async function createFlight(overrides: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/flights')
      .set('Cookie', modCookie)
      .send(flightBody(overrides))
      .expect(201);
    return res.body.id as string;
  }

  /** Cabins are not creatable through the API yet (FLT-04), so tests insert them directly. */
  async function addCabin(
    flightId: string,
    cabinClass: string,
    totalSeats: number,
    bookedSeats: number,
    heldSeats: number,
    priceCents: number,
  ) {
    await connection.collection('cabins').insertOne({
      flightId: new Types.ObjectId(flightId),
      cabinClass,
      totalSeats,
      bookedSeats,
      heldSeats,
      priceCents,
    });
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

    await connection.collection('airports').insertMany([
      { iata_code: 'CAI', name: 'Cairo', city_id: 'c1', country_code: 'EG', time_zone: 'Africa/Cairo' },
      { iata_code: 'JFK', name: 'John F. Kennedy', city_id: 'c2', country_code: 'US', time_zone: 'America/New_York' },
    ]);

    const admin = await loginAs('admin@example.com', { role: Role.ADMIN });
    airline = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline A', code: 'AA' })
        .expect(201)
    ).body;
    modCookie = await loginAs('moda@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(airline.id),
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  afterEach(async () => {
    await connection.collection('flights').deleteMany({});
    await connection.collection('cabins').deleteMany({});
    await connection
      .collection('airlines')
      .updateOne({ _id: new Types.ObjectId(airline.id) }, { $set: { isActive: true } });
  });

  describe('GET /api/flights/search', () => {
    it('is public and lists a matching flight with only the cabins that fit all passengers', async () => {
      const id = await createFlight();
      await addCabin(id, 'ECONOMY', 100, 30, 5, 45000); // 65 available
      await addCabin(id, 'BUSINESS', 8, 7, 0, 120000); // 1 available

      const res = await http().get(SEARCH).query(query()).expect(200);

      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 1, totalPages: 1 });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        id,
        flightNumber: 'MS777',
        airline: { id: airline.id, name: 'Airline A', code: 'AA' },
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureAt: '2090-12-01T12:30:00.000Z',
        departureLocal: '2090-12-01T14:30:00+02:00',
        arrivalLocal: '2090-12-01T19:45:00-05:00',
        departureTimeZone: 'Africa/Cairo',
        arrivalTimeZone: 'America/New_York',
      });
      expect(typeof res.body.items[0].currency).toBe('string');
      expect(res.body.items[0].cabins).toEqual([
        { cabinClass: 'ECONOMY', priceCents: 45000, availableSeats: 65 },
      ]);
    });

    it('lists every cabin that fits, cheapest first', async () => {
      const id = await createFlight();
      await addCabin(id, 'BUSINESS', 8, 7, 0, 120000);
      await addCabin(id, 'ECONOMY', 100, 30, 5, 45000);

      const res = await http().get(SEARCH).query(query({ passengers: 1 })).expect(200);

      expect(res.body.items[0].cabins.map((c: { cabinClass: string }) => c.cabinClass)).toEqual([
        'ECONOMY',
        'BUSINESS',
      ]);
    });

    it('counts held seats as unavailable (total - booked - held)', async () => {
      const id = await createFlight();
      await addCabin(id, 'ECONOMY', 10, 4, 4, 45000); // 2 available
      await http().get(SEARCH).query(query({ passengers: 2 })).expect(200).expect((r) => expect(r.body.total).toBe(1));
      await http().get(SEARCH).query(query({ passengers: 3 })).expect(200).expect((r) => expect(r.body.total).toBe(0));
    });

    it('too many passengers: 200 with an empty list, not an error', async () => {
      const id = await createFlight();
      await addCabin(id, 'ECONOMY', 100, 30, 5, 45000);
      const res = await http().get(SEARCH).query(query({ passengers: 70 })).expect(200);
      expect(res.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
    });

    it('another date or another route: empty list', async () => {
      const id = await createFlight();
      await addCabin(id, 'ECONOMY', 100, 0, 0, 45000);
      await http().get(SEARCH).query(query({ departureDate: '2090-12-02' })).expect(200)
        .expect((r) => expect(r.body.items).toEqual([]));
      await http().get(SEARCH).query(query({ departureAirport: 'JFK', arrivalAirport: 'CAI' })).expect(200)
        .expect((r) => expect(r.body.items).toEqual([]));
    });

    it('a flight with no cabins is not listed', async () => {
      await createFlight();
      const res = await http().get(SEARCH).query(query()).expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('matches the LOCAL date at the departure airport, not the UTC date', async () => {
      // 00:30 in Cairo on 1 Dec is 22:30Z on 30 Nov: still "1 Dec" for a Cairo traveller.
      const id = await createFlight({
        departureLocalTime: '2090-12-01T00:30',
        arrivalLocalTime: '2090-12-01T06:00',
      });
      await addCabin(id, 'ECONOMY', 100, 0, 0, 45000);
      await http().get(SEARCH).query(query({ departureDate: '2090-12-01' })).expect(200)
        .expect((r) => expect(r.body.total).toBe(1));
      await http().get(SEARCH).query(query({ departureDate: '2090-11-30' })).expect(200)
        .expect((r) => expect(r.body.total).toBe(0));
    });

    it.each(['CANCELLED', 'DEPARTED'])('a %s flight is excluded', async (status) => {
      const id = await createFlight();
      await addCabin(id, 'ECONOMY', 100, 0, 0, 45000);
      await connection.collection('flights').updateOne({ _id: new Types.ObjectId(id) }, { $set: { status } });
      const res = await http().get(SEARCH).query(query()).expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('a flight of an inactive airline is excluded', async () => {
      const id = await createFlight();
      await addCabin(id, 'ECONOMY', 100, 0, 0, 45000);
      await connection
        .collection('airlines')
        .updateOne({ _id: new Types.ObjectId(airline.id) }, { $set: { isActive: false } });
      const res = await http().get(SEARCH).query(query()).expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('paginates and orders by departure time', async () => {
      const early = await createFlight({ flightNumber: 'MS100', departureLocalTime: '2090-12-01T08:00', arrivalLocalTime: '2090-12-01T13:00' });
      const late = await createFlight({ flightNumber: 'MS200' });
      await addCabin(early, 'ECONOMY', 100, 0, 0, 45000);
      await addCabin(late, 'ECONOMY', 100, 0, 0, 45000);

      const first = await http().get(SEARCH).query(query({ limit: 1, page: 1 })).expect(200);
      expect(first.body).toMatchObject({ total: 2, totalPages: 2, page: 1, limit: 1 });
      expect(first.body.items[0].id).toBe(early);

      const second = await http().get(SEARCH).query(query({ limit: 1, page: 2 })).expect(200);
      expect(second.body.items[0].id).toBe(late);
    });
    
 describe('price filter and sorting (FLT-15)', () => {
      const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

      /** Flight with an ECONOMY (45000) and a BUSINESS (120000) cabin, both with seats left. */
      async function twoCabinFlight() {
        const id = await createFlight();
        await addCabin(id, 'ECONOMY', 100, 0, 0, 45000);
        await addCabin(id, 'BUSINESS', 8, 4, 0, 120000);
        return id;
      }

      it('min and max are inclusive and only matching cabins are listed', async () => {
        await twoCabinFlight();
        const exact = await http()
          .get(SEARCH)
          .query(query({ passengers: 1, minPrice: 45000, maxPrice: 45000 }))
          .expect(200);
        expect(exact.body.items[0].cabins.map((c: { cabinClass: string }) => c.cabinClass)).toEqual(['ECONOMY']);

        const top = await http()
          .get(SEARCH)
          .query(query({ passengers: 1, minPrice: 120000 }))
          .expect(200);
        expect(top.body.items[0].cabins.map((c: { cabinClass: string }) => c.cabinClass)).toEqual(['BUSINESS']);
      });

      it('only minPrice or only maxPrice works', async () => {
        await twoCabinFlight();
        await http().get(SEARCH).query(query({ passengers: 1, maxPrice: 50000 })).expect(200)
          .expect((r) => expect(r.body.items[0].cabins).toHaveLength(1));
        await http().get(SEARCH).query(query({ passengers: 1, minPrice: 0 })).expect(200)
          .expect((r) => expect(r.body.items[0].cabins).toHaveLength(2));
      });

      it('a flight with no cabin in the range is excluded', async () => {
        await twoCabinFlight();
        const res = await http()
          .get(SEARCH)
          .query(query({ passengers: 1, minPrice: 50000, maxPrice: 100000 }))
          .expect(200);
        expect(res.body.items).toEqual([]);
      });

      it('the filter keeps the other criteria (seats, date, route)', async () => {
        await twoCabinFlight(); // BUSINESS has only 4 seats left
        await http().get(SEARCH).query(query({ passengers: 5, minPrice: 100000 })).expect(200)
          .expect((r) => expect(r.body.items).toEqual([]));
        await http().get(SEARCH).query(query({ passengers: 1, minPrice: 0, departureDate: '2090-12-02' })).expect(200)
          .expect((r) => expect(r.body.items).toEqual([]));
        await http().get(SEARCH).query(query({ passengers: 1, minPrice: 0, arrivalAirport: 'CAI', departureAirport: 'JFK' })).expect(200)
          .expect((r) => expect(r.body.items).toEqual([]));
      });

      it('minPrice greater than maxPrice: 400 with a field-level detail', async () => {
        const res = await http()
          .get(SEARCH)
          .query(query({ minPrice: 90000, maxPrice: 45000 }))
          .expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'minPrice' })]),
        );
      });

      it.each([
        [{ minPrice: -1 }, 'minPrice'],
        [{ maxPrice: 'abc' }, 'maxPrice'],
        [{ minPrice: 10.5 }, 'minPrice'],
        [{ sort: 'cheapest' }, 'sort'],
        [{ order: 'up' }, 'order'],
      ])('invalid %j: 400 on %s', async (params, field) => {
        const res = await http().get(SEARCH).query(query(params as Record<string, string | number>)).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      });

      // Two flights: A leaves 08:00 (cheapest 90000, long: 19 h), B leaves 14:30 (cheapest 45000, 11.5 h).
      async function flightsAB() {
        const a = await createFlight({
          flightNumber: 'MS100',
          departureLocalTime: '2090-12-01T08:00',
          arrivalLocalTime: '2090-12-01T20:00',
        });
        const b = await createFlight({
          flightNumber: 'MS200',
          arrivalLocalTime: '2090-12-01T19:00',
        });
        await addCabin(a, 'ECONOMY', 100, 0, 0, 90000);
        await addCabin(b, 'ECONOMY', 100, 0, 0, 45000);
        return { a, b };
      }

      it('default sort is departure time ascending', async () => {
        const { a, b } = await flightsAB();
        const res = await http().get(SEARCH).query(query()).expect(200);
        expect(ids(res.body)).toEqual([a, b]);
      });

      it('sort=departureTime with order=desc reverses it', async () => {
        const { a, b } = await flightsAB();
        const res = await http().get(SEARCH).query(query({ sort: 'departureTime', order: 'desc' })).expect(200);
        expect(ids(res.body)).toEqual([b, a]);
      });

      it('sort=price orders by the cheapest matching cabin', async () => {
        const { a, b } = await flightsAB();
        const asc = await http().get(SEARCH).query(query({ sort: 'price' })).expect(200);
        expect(ids(asc.body)).toEqual([b, a]);
        const desc = await http().get(SEARCH).query(query({ sort: 'price', order: 'desc' })).expect(200);
        expect(ids(desc.body)).toEqual([a, b]);
      });

      it('sort=price uses only cabins inside the price filter', async () => {
        const { a, b } = await flightsAB();
        await addCabin(a, 'BUSINESS', 8, 0, 0, 20000); // would make A the cheapest if not filtered
        const res = await http()
          .get(SEARCH)
          .query(query({ sort: 'price', minPrice: 40000 }))
          .expect(200);
        expect(ids(res.body)).toEqual([b, a]);
      });

      it('sort=duration orders by arrival minus departure in UTC', async () => {
        const { a, b } = await flightsAB();
        const asc = await http().get(SEARCH).query(query({ sort: 'duration' })).expect(200);
        expect(ids(asc.body)).toEqual([b, a]);
        const desc = await http().get(SEARCH).query(query({ sort: 'duration', order: 'desc' })).expect(200);
        expect(ids(desc.body)).toEqual([a, b]);
      });

      it('sorting keeps pagination consistent', async () => {
        const { a, b } = await flightsAB();
        const first = await http().get(SEARCH).query(query({ sort: 'price', limit: 1, page: 1 })).expect(200);
        const second = await http().get(SEARCH).query(query({ sort: 'price', limit: 1, page: 2 })).expect(200);
        expect(ids(first.body)).toEqual([b]);
        expect(ids(second.body)).toEqual([a]);
        expect(first.body.total).toBe(2);
      });
    });

    describe('validation (400 with field-level details)', () => {
      const failsOn = async (params: Record<string, string | number>, field: string) => {
        const res = await http().get(SEARCH).query(params).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
        return res;
      };

      it('impossible calendar date', () => failsOn(query({ departureDate: '2090-02-30' }), 'departureDate'));
      it('malformed date', () => failsOn(query({ departureDate: '01/12/2090' }), 'departureDate'));
      it('identical airports', () => failsOn(query({ arrivalAirport: 'CAI' }), 'arrivalAirport'));
      it('unknown airport', () => failsOn(query({ departureAirport: 'ZZZ' }), 'departureAirport'));
      it('passengers = 0', () => failsOn(query({ passengers: 0 }), 'passengers'));
      it('passengers not a number', () => failsOn(query({ passengers: 'abc' }), 'passengers'));

      it('missing parameters list every missing field', async () => {
        const res = await http().get(SEARCH).expect(400);
        const fields = res.body.details.map((d: { field: string }) => d.field);
        expect(fields).toEqual(
          expect.arrayContaining(['departureAirport', 'arrivalAirport', 'departureDate', 'passengers']),
        );
      });

      it('errors use the contract shape', async () => {
        const res = await http().get(SEARCH).expect(400);
        expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
        expect(res.body.path).toContain('/api/flights/search');
        expect(typeof res.body.timestamp).toBe('string');
      });
    });
  });
});