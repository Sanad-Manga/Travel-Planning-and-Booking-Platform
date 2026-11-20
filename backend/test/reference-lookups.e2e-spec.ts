import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/** GEN-12: public, paginated GET /api/countries, /api/cities and /api/currencies. */
describe('Reference-data lookups (GEN-12)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;
  const get = (url: string) => request(app.getHttpServer()).get(url);
  const stamp = { createdAt: new Date(), updatedAt: new Date() };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    // Set BEFORE AppModule is imported so nothing from backend/.env can win.
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());

    // Inserted out of order on purpose: the API must sort by the official code, not by insertion.
    await db.collection('countries').insertMany([
      { code: 'US', name: 'United States', currency: 'USD', ...stamp },
      { code: 'EG', name: 'Egypt', currency: 'EGP', ...stamp },
      { code: 'GB', name: 'United Kingdom', currency: 'GBP', ...stamp },
    ]);
    await db.collection('cities').insertMany([
      { city_id: 'new-york', name: 'New York', country_code: 'US', ...stamp },
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG', ...stamp },
      {
        city_id: 'alexandria',
        name: 'Alexandria',
        country_code: 'EG',
        ...stamp,
      },
      { city_id: 'london', name: 'London', country_code: 'GB', ...stamp },
    ]);
    await db.collection('currencies').insertMany([
      { code: 'USD', ...stamp },
      { code: 'EGP', ...stamp },
      { code: 'GBP', ...stamp },
    ]);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('GET /api/countries', () => {
    it('is public and lists countries by official code with name and currency, in the shared envelope', async () => {
      const res = await get('/api/countries').expect(200);
      expect(res.body).toEqual({
        items: [
          { code: 'EG', name: 'Egypt', currency: 'EGP' },
          { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
          { code: 'US', name: 'United States', currency: 'USD' },
        ],
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
      // No MongoDB internals leak.
      expect(JSON.stringify(res.body)).not.toMatch(/_id|createdAt|__v/);
    });

    it('paginates', async () => {
      const res = await get('/api/countries?page=2&limit=2').expect(200);
      expect(res.body).toMatchObject({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(res.body.items).toEqual([
        { code: 'US', name: 'United States', currency: 'USD' },
      ]);
    });

    it('rejects a bad page, a limit over 50 and an unknown query parameter with 400', async () => {
      await get('/api/countries?page=0').expect(400);
      await get('/api/countries?limit=51').expect(400);
      await get('/api/countries?continent=Africa').expect(400);
    });
  });

  describe('GET /api/cities', () => {
    it('is public and lists cities by official id with the country code', async () => {
      const res = await get('/api/cities').expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 4 });
      expect(res.body.items).toEqual([
        { cityId: 'alexandria', name: 'Alexandria', countryCode: 'EG' },
        { cityId: 'cairo', name: 'Cairo', countryCode: 'EG' },
        { cityId: 'london', name: 'London', countryCode: 'GB' },
        { cityId: 'new-york', name: 'New York', countryCode: 'US' },
      ]);
    });

    it('filters by country, in any letter case, and paginates the filtered list', async () => {
      const res = await get('/api/cities?countryCode=eg').expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items.map((c: { cityId: string }) => c.cityId)).toEqual([
        'alexandria',
        'cairo',
      ]);

      const paged = await get(
        '/api/cities?countryCode=EG&limit=1&page=2',
      ).expect(200);
      expect(paged.body).toMatchObject({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(paged.body.items).toEqual([
        { cityId: 'cairo', name: 'Cairo', countryCode: 'EG' },
      ]);
    });

    it('a well-formed country code that no country uses is an empty page, not an error', async () => {
      const res = await get('/api/cities?countryCode=ZZ').expect(200);
      expect(res.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('rejects a malformed country code with a field-level 400', async () => {
      for (const bad of ['EGY', 'E', '12', 'E%20']) {
        const res = await get(`/api/cities?countryCode=${bad}`).expect(400);
        expect(res.body.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: 'countryCode' }),
          ]),
        );
      }
      await get('/api/cities?country=EG').expect(400);
    });
  });

  describe('GET /api/currencies', () => {
    it('is public and lists currencies by official code', async () => {
      const res = await get('/api/currencies').expect(200);
      expect(res.body).toEqual({
        items: [{ code: 'EGP' }, { code: 'GBP' }, { code: 'USD' }],
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });

    it('paginates and rejects bad pagination', async () => {
      const res = await get('/api/currencies?limit=2').expect(200);
      expect(res.body).toMatchObject({ limit: 2, total: 3, totalPages: 2 });
      expect(res.body.items).toEqual([{ code: 'EGP' }, { code: 'GBP' }]);
      await get('/api/currencies?page=abc').expect(400);
    });
  });

  it('is documented in Swagger as public, paginated routes', async () => {
    const docs = await get('/api/docs-json').expect(200);
    for (const path of ['/api/countries', '/api/cities', '/api/currencies']) {
      const operation = docs.body.paths[path]?.get;
      expect(operation).toBeDefined();
      expect(operation.security).toEqual([]);
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['200', '400']),
      );
    }
  });

  it('exposes no write routes', async () => {
    await request(app.getHttpServer())
      .post('/api/countries')
      .send({ code: 'XX', name: 'Nowhere', currency: 'XXX' })
      .expect((res) => expect([401, 404, 405]).toContain(res.status));
  });
});
