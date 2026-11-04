import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { OpenAPIObject } from '@nestjs/swagger';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { setupApp, setupSwagger } from '../setup-app';
import { BookingLifecycle, BookingProviderRegistry } from '../payments';
import { AirportResponseDto } from './dto/airport-response.dto';
import {
  createReferenceModels,
  ReferenceModels,
} from './reference-data.models';
import { ReferenceDataModule } from './reference-data.module';
import { ReferenceDataService } from './reference-data.service';
import { loadReferenceData } from './seed/reference-data.loader';

// Shared constants call dotenv.config during import. No test may read the developer's .env.
jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

jest.setTimeout(120000);

describe('GET /api/airports through the real AppModule', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let models: ReferenceModels;
  const testEnvironment = {
    MONGODB_URI: '',
    JWT_ACCESS_SECRET: 'airport-test-access-0123456789-abcdefghijkl',
    JWT_REFRESH_SECRET: 'airport-test-refresh-0123456789-abcdefghijk',
    COOKIE_SECURE: 'false',
  };
  const previousEnvironment = new Map(
    Object.keys(testEnvironment).map((key) => [key, process.env[key]]),
  );
  const country = { code: 'QA', name: 'Qatar', currency: 'QAR' };
  const city = { city_id: 'doha', name: 'Doha', country_code: country.code };
  // Deliberately larger than both the current CSV and the maximum page size.
  const fixtures = Array.from({ length: 63 }, (_, i) => ({
    iata_code: `Z${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
    name: `Fixture Airport ${i}`,
    city_id: city.city_id,
    country_code: country.code,
    time_zone: 'Asia/Qatar',
  }));

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({
      instance: { dbName: 'flt02_disposable_test' },
    });
    Object.assign(process.env, testEnvironment, {
      MONGODB_URI: mongo.getUri(),
    });
    const originalForRoot = ConfigModule.forRoot.bind(ConfigModule);
    // Keep real validation/configuration and all application modules; disable only file loading.
    const noEnvFiles = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        originalForRoot({ ...options, ignoreEnvFile: true }),
      );
    try {
      const { AppModule } = await import('../app.module');
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication();
      app.useLogger(false);
      setupApp(app);
      setupSwagger(app);
      await app.listen(0, '127.0.0.1');
      models = createReferenceModels(app.get<Connection>(getConnectionToken()));
      await Promise.all(Object.values(models).map((model) => model.init()));
    } finally {
      noEnvFiles.mockRestore();
    }
  });

  beforeEach(async () => {
    // These models use only the MongoMemoryServer created above, never a shared connection.
    await Promise.all([
      models.airports.deleteMany({}),
      models.cities.deleteMany({}),
      models.countries.deleteMany({}),
    ]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function insertFixtures() {
    await models.countries.create(country);
    await models.cities.create(city);
    // Reverse insertion order ensures the API is not ordering by insertion/CSV position.
    await models.airports.insertMany([...fixtures].reverse());
  }

  it('registers reference data alongside existing auth, payments and notifications modules', async () => {
    expect(app.get(ReferenceDataModule)).toBeDefined();
    expect(app.get(ReferenceDataService)).toBeDefined();
    expect(app.get(BookingLifecycle)).toBeDefined();
    expect(app.get(BookingProviderRegistry)).toBeDefined();
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
    await request(app.getHttpServer()).get('/airports').expect(404);
    const response = await request(app.getHttpServer())
      .get('/api/airports')
      .expect(200);
    expect(response.body).toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('returns official records, names and IANA zones without exposing raw MongoDB fields', async () => {
    const official = await loadReferenceData();
    await models.countries.insertMany(official.countries);
    await models.cities.insertMany(official.cities);
    await models.airports.insertMany([...official.airports].reverse());
    const airports: AirportResponseDto[] = [];
    for (
      let page = 1;
      page <= Math.ceil(official.airports.length / 50);
      page++
    ) {
      const response = await request(app.getHttpServer())
        .get(`/api/airports?page=${page}&limit=50`)
        .expect(200);
      expect(response.body.total).toBe(official.airports.length);
      airports.push(...response.body.items);
    }
    expect(airports.map((airport) => airport.iataCode)).toEqual(
      official.airports.map((airport) => airport.iata_code).sort(),
    );
    for (const airport of airports) {
      const source = official.airports.find(
        (row) => row.iata_code === airport.iataCode,
      )!;
      expect(airport).toEqual({
        id: expect.stringMatching(/^[a-f\d]{24}$/),
        iataCode: source.iata_code,
        name: source.name,
        city: {
          cityId: source.city_id,
          name: official.cities.find((row) => row.city_id === source.city_id)!
            .name,
        },
        country: {
          code: source.country_code,
          name: official.countries.find(
            (row) => row.code === source.country_code,
          )!.name,
        },
        timeZone: source.time_zone,
      });
    }
  });

  it('supports guests, default pagination and datasets larger than the current CSV', async () => {
    await insertFixtures();
    const response = await request(app.getHttpServer())
      .get('/api/airports')
      .set('Cookie', 'access_token=invalid')
      .expect(200);
    expect(response.body).toMatchObject({
      page: 1,
      limit: 10,
      total: fixtures.length,
      totalPages: Math.ceil(fixtures.length / 10),
    });
    expect(
      response.body.items.map(
        (airport: AirportResponseDto) => airport.iataCode,
      ),
    ).toEqual(fixtures.slice(0, 10).map((airport) => airport.iata_code));
  });

  it('paginates deterministically across pages and enforces the supported maximum page size', async () => {
    await insertFixtures();
    const first = await request(app.getHttpServer())
      .get('/api/airports?page=1&limit=7')
      .expect(200);
    const second = await request(app.getHttpServer())
      .get('/api/airports?page=2&limit=7')
      .expect(200);
    const repeated = await request(app.getHttpServer())
      .get('/api/airports?page=2&limit=7')
      .expect(200);
    expect(second.body).toEqual(repeated.body);
    expect(second.body).toMatchObject({
      page: 2,
      limit: 7,
      total: fixtures.length,
      totalPages: 9,
    });
    expect(
      [...first.body.items, ...second.body.items].map(
        (airport: AirportResponseDto) => airport.iataCode,
      ),
    ).toEqual(fixtures.slice(0, 14).map((airport) => airport.iata_code));
    const max = await request(app.getHttpServer())
      .get('/api/airports?limit=50')
      .expect(200);
    expect(max.body.items).toHaveLength(50);
    expect(max.body.totalPages).toBe(2);
    const beyond = await request(app.getHttpServer())
      .get('/api/airports?page=999')
      .expect(200);
    expect(beyond.body).toEqual({
      items: [],
      page: 999,
      limit: 10,
      total: fixtures.length,
      totalPages: Math.ceil(fixtures.length / 10),
    });
  });

  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=abc',
    'limit=0',
    'limit=51',
    'limit=1.5',
    'limit=abc',
    'country=QA',
  ])(
    'rejects invalid or unsupported query %s in the shared error format',
    async (query) => {
      const response = await request(app.getHttpServer())
        .get(`/api/airports?${query}`)
        .expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: expect.any(Array),
        path: '/api/airports',
        timestamp: expect.any(String),
      });
    },
  );

  it('reads changed airport and relationship data from MongoDB on subsequent requests', async () => {
    await models.countries.create(country);
    await models.cities.create(city);
    await models.airports.create(fixtures[0]);
    const first = await request(app.getHttpServer())
      .get('/api/airports')
      .expect(200);
    expect(first.body.total).toBe(1);
    await models.airports.create(fixtures[1]);
    await models.airports.updateOne(
      { iata_code: fixtures[0].iata_code },
      { $set: { name: 'Updated airport' } },
    );
    await models.cities.updateOne(
      { city_id: city.city_id },
      { $set: { name: 'Updated city' } },
    );
    await models.countries.updateOne(
      { code: country.code },
      { $set: { name: 'Updated country' } },
    );
    const updated = await request(app.getHttpServer())
      .get('/api/airports')
      .expect(200);
    expect(updated.body.total).toBe(2);
    expect(updated.body.items[0]).toMatchObject({
      name: 'Updated airport',
      city: { name: 'Updated city' },
      country: { name: 'Updated country' },
    });
  });

  it('exposes no airport mutation routes and leaves database records unchanged', async () => {
    await insertFixtures();
    const client = request(app.getHttpServer());
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      await client[method]('/api/airports')
        .send({ name: 'Not allowed' })
        .expect(404);
      await client[method](`/api/airports/${fixtures[0].iata_code}`)
        .send({ name: 'Not allowed' })
        .expect(404);
    }
    expect(await models.airports.countDocuments()).toBe(fixtures.length);
    expect(
      await models.airports
        .findOne({ iata_code: fixtures[0].iata_code })
        .lean(),
    ).toMatchObject({ name: fixtures[0].name });
  });

  it('returns a controlled error if an airport has missing reference data', async () => {
    await models.airports.create(fixtures[0]);
    const response = await request(app.getHttpServer())
      .get('/api/airports')
      .expect(500);
    expect(response.body).toMatchObject({
      statusCode: 500,
      message: 'Airport reference data is incomplete or inconsistent',
      path: '/api/airports',
    });
  });

  it('uses the shared error filter without leaking database error details', async () => {
    jest.spyOn(models.airports, 'countDocuments').mockImplementationOnce(() => {
      throw new Error('internal-database-details');
    });
    const response = await request(app.getHttpServer())
      .get('/api/airports')
      .expect(500);
    expect(response.body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'internal-database-details',
    );
  });

  it('serves Swagger with a public GET, pagination, nested response DTOs and relevant errors', async () => {
    await request(app.getHttpServer()).get('/api/docs').expect(200);
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const document = response.body as OpenAPIObject;
    const path = document.paths['/api/airports'];
    expect(Object.keys(path!)).toEqual(['get']);
    expect(path!.get!.security).toEqual([]);
    expect(path!.get!.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'page',
          in: 'query',
          schema: expect.objectContaining({ default: 1 }),
        }),
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          schema: expect.objectContaining({ default: 10, maximum: 50 }),
        }),
      ]),
    );
    expect(Object.keys(path!.get!.responses)).toEqual(
      expect.arrayContaining(['200', '400', '500']),
    );
    const schema = document.components!.schemas!.AirportResponseDto;
    expect(schema).toMatchObject({
      required: ['id', 'iataCode', 'name', 'city', 'country', 'timeZone'],
    });
    expect(document.components!.schemas!.AirportCityDto).toBeDefined();
    expect(document.components!.schemas!.AirportCountryDto).toBeDefined();
    expect(document.paths['/api/auth/me']).toBeDefined();
    expect(document.paths['/api/notifications']).toBeDefined();
  });
});
