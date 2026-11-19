import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import {
  createReferenceModels,
  ReferenceModels,
} from '../src/reference-data/reference-data.models';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import { setupApp, setupSwagger } from '../src/setup-app';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

const routes = ['/api/countries', '/api/cities', '/api/currencies'] as const;
const env = {
  MONGODB_URI: '',
  JWT_ACCESS_SECRET: 'gen12-lookups-test-access-0123456789',
  JWT_REFRESH_SECRET: 'gen12-lookups-test-refresh-0123456789',
  COOKIE_SECURE: 'false',
};
const previousEnv = Object.keys(env).map(
  (key) => [key, process.env[key]] as const,
);

const egypt = { code: 'EG', name: 'Egypt', currency: 'EGP' };
const france = { code: 'FR', name: 'France', currency: 'EUR' };
const countries = [
  ...Array.from({ length: 10 }, (_, index) => ({
    code: 'A' + String.fromCharCode(65 + index),
    name: 'Fixture country ' + index,
    currency: 'AA' + String.fromCharCode(65 + index),
  })),
  egypt,
  france,
];
const egyptianCities = Array.from({ length: 12 }, (_, index) => ({
  city_id: 'egypt-' + String(index).padStart(2, '0'),
  name: 'Fixture Egyptian city ' + index,
  country_code: egypt.code,
}));
const paris = { city_id: 'paris', name: 'Paris', country_code: france.code };
const cities = [...egyptianCities, paris];
const currencies = [
  ...countries.map(({ currency: code }) => ({ code })),
  { code: 'JPY' },
];
const airport = {
  iata_code: 'CAI',
  name: 'Fixture Airport',
  city_id: egyptianCities[0].city_id,
  country_code: egypt.code,
  time_zone: 'Africa/Cairo',
};
const emptyPage = { items: [], page: 1, limit: 10, total: 0, totalPages: 0 };

describe('GEN-12 reference lookups through the real AppModule', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let models: ReferenceModels;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({
      instance: { dbName: 'gen12_lookup_test' },
    });
    Object.assign(process.env, env, { MONGODB_URI: mongo.getUri() });

    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const spy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        configure({ ...options, ignoreEnvFile: true }),
      );
    try {
      const { AppModule } = await import('../src/app.module');
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = module.createNestApplication();
      app.useLogger(false);
      setupApp(app);
      setupSwagger(app);
      await app.listen(0, '127.0.0.1');
      models = createReferenceModels(app.get<Connection>(getConnectionToken()));
      await Promise.all(Object.values(models).map((model) => model.init()));
    } finally {
      spy.mockRestore();
    }
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each(routes)(
    'returns the standard empty page publicly for %s',
    async (route) => {
      expect((await http().get(route).expect(200)).body).toEqual(emptyPage);
    },
  );

  describe('with seeded records', () => {
    beforeAll(async () => {
      await models.countries.insertMany([...countries].reverse());
      await models.cities.insertMany([...cities].reverse());
      await models.currencies.insertMany([...currencies].reverse());
      await models.airports.create(airport);
    });

    it.each([
      { route: routes[0], rows: countries },
      { route: routes[1], rows: cities },
      { route: routes[2], rows: currencies },
    ])(
      'returns exact fields in stable public pages for $route',
      async ({ route, rows }) => {
        const first = await http().get(route).expect(200);
        expect(first.body).toEqual({
          items: rows.slice(0, 10),
          page: 1,
          limit: 10,
          total: rows.length,
          totalPages: 2,
        });
        for (let i = 0; i < 2; i++) {
          const next = await http().get(route).query({ page: 2 }).expect(200);
          expect(next.body).toEqual({
            items: rows.slice(10),
            page: 2,
            limit: 10,
            total: rows.length,
            totalPages: 2,
          });
        }
        const beyond = await http()
          .get(route)
          .query({ page: 3, limit: 10 })
          .expect(200);
        expect(beyond.body).toEqual({
          items: [],
          page: 3,
          limit: 10,
          total: rows.length,
          totalPages: 2,
        });
      },
    );

    it('filters by country before counting and slicing, with several cities per country', async () => {
      const first = await http()
        .get('/api/cities')
        .query({ countryCode: ' eg ', limit: 5 })
        .expect(200);
      expect(first.body).toEqual({
        items: egyptianCities.slice(0, 5),
        page: 1,
        limit: 5,
        total: 12,
        totalPages: 3,
      });
      const third = await http()
        .get('/api/cities')
        .query({ countryCode: 'EG', page: 3, limit: 5 })
        .expect(200);
      expect(third.body).toEqual({
        items: egyptianCities.slice(10),
        page: 3,
        limit: 5,
        total: 12,
        totalPages: 3,
      });
      const other = await http()
        .get('/api/cities')
        .query({ countryCode: 'FR' })
        .expect(200);
      expect(other.body.items).toEqual([paris]);
      expect(other.body.total).toBe(1);
      const missing = await http()
        .get('/api/cities')
        .query({ countryCode: 'ZZ' })
        .expect(200);
      expect(missing.body).toEqual(emptyPage);
    });

    it.each([
      [routes[0], 'page=0', 'page'],
      [routes[0], 'limit=51', 'limit'],
      [routes[0], 'countryCode=EG', 'countryCode'],
      [routes[1], 'countryCode=123', 'countryCode'],
      [routes[1], 'countryCode=EGY', 'countryCode'],
      [routes[1], 'countryCode=%20', 'countryCode'],
      [routes[1], 'countryCode=EG&countryCode=FR', 'countryCode'],
      [routes[1], 'countryCode%5B%24ne%5D=EG', 'countryCode[$ne]'],
      [routes[1], 'sort=name', 'sort'],
      [routes[2], 'limit=0', 'limit'],
      [routes[2], 'page=abc', 'page'],
      [routes[2], 'code=EGP', 'code'],
    ])(
      'rejects invalid query %s?%s with a field-level error',
      async (route, query, field) => {
        const response = await http()
          .get(route + '?' + query)
          .expect(400);
        expect(response.body).toMatchObject({
          statusCode: 400,
          message: 'Validation failed',
          path: route,
          details: expect.arrayContaining([
            { field, message: expect.any(String) },
          ]),
        });
      },
    );

    it('preserves airports and existing internal reference-data lookups', async () => {
      const existing = await http().get('/api/airports').expect(200);
      expect(existing.body.items).toEqual([
        {
          id: expect.any(String),
          iataCode: airport.iata_code,
          name: airport.name,
          city: { cityId: airport.city_id, name: egyptianCities[0].name },
          country: { code: egypt.code, name: egypt.name },
          timeZone: airport.time_zone,
        },
      ]);
      const service = app.get(ReferenceDataService);
      await expect(service.listCountries()).resolves.toEqual(countries);
      await expect(service.listCitiesByCountry(egypt.code)).resolves.toEqual(
        egyptianCities,
      );
      await expect(service.findCurrencyById('JPY')).resolves.toEqual({
        code: 'JPY',
      });
      await expect(service.findAirportById(airport.iata_code)).resolves.toEqual(
        airport,
      );
    });

    it('leaves reference-data records unchanged and exposes no write routes', async () => {
      const snapshot = () =>
        Promise.all([
          models.countries.find().sort({ code: 1 }).lean().exec(),
          models.cities.find().sort({ city_id: 1 }).lean().exec(),
          models.currencies.find().sort({ code: 1 }).lean().exec(),
          models.airports.find().sort({ iata_code: 1 }).lean().exec(),
        ]);
      const before = await snapshot();
      for (const route of routes) {
        await http().get(route).expect(200);
        await http().post(route).expect(404);
        await http().patch(route).expect(404);
        await http().delete(route).expect(404);
      }
      expect(await snapshot()).toEqual(before);
    });

    it('returns a sanitized 500 on a database read failure', async () => {
      jest.spyOn(models.currencies, 'countDocuments').mockImplementationOnce(
        () =>
          ({
            exec: () =>
              Promise.reject(new Error('synthetic-driver-diagnostic')),
          }) as never,
      );
      const result = await http().get('/api/currencies').expect(500);
      expect(result.body).toMatchObject({
        statusCode: 500,
        message: 'Reference data could not be retrieved',
      });
      expect(JSON.stringify(result.body)).not.toContain(
        'synthetic-driver-diagnostic',
      );
    });
  });

  it('documents three public GETs, response schemas, query filters and errors in Swagger', async () => {
    const docs = (await http().get('/api/docs-json').expect(200)).body;
    const dtos = [
      'CountryResponseDto',
      'CityResponseDto',
      'CurrencyResponseDto',
    ];
    for (const [index, route] of routes.entries()) {
      expect(Object.keys(docs.paths[route])).toEqual(['get']);
      const operation = docs.paths[route].get;
      expect(operation.security).toEqual([]);
      expect(
        operation.parameters.map(({ name }: { name: string }) => name).sort(),
      ).toEqual(
        index === 1 ? ['countryCode', 'limit', 'page'] : ['limit', 'page'],
      );
      expect(
        operation.responses['200'].content['application/json'].schema.properties
          .items.items.$ref,
      ).toBe('#/components/schemas/' + dtos[index]);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['200', '400', '500']),
      );
    }
  });
});
