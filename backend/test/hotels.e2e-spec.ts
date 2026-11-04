import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { Role } from '../src/common';
import configuration from '../src/config/configuration';
import { HotelsModule } from '../src/hotels/hotels.module';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

describe('HTL-01 hotel profile (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const validHotel = (over: Record<string, unknown> = {}) => ({
    name: 'Nile View Hotel',
    address: '12 Corniche El Nil',
    cityId: 'CAI',
    description: 'Riverside hotel.',
    starRating: 4,
    amenities: ['Wifi', 'Pool'],
    ...over,
  });

  const insertUser = (email: string, extra: Record<string, unknown>) =>
    connection.collection('users').insertOne({
      name: 'Seeded',
      email,
      passwordHash: hashSync(PASSWORD, 4),
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });

  const loginCookie = async (email: string): Promise<string> => {
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return ((res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('access_token=')) as string).split(';')[0];
  };

  let admin: string;
  let userCookie: string;
  let modA: string;
  let modB: string;
  let hotelA: string;
  let hotelB: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryServer.create();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        HotelsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('Hotel').init(); // build the unique index before the tests run

    await connection.collection('cities').insertMany([
      { city_id: 'CAI', name: 'Cairo', country_code: 'EG' },
      { city_id: 'ALX', name: 'Alexandria', country_code: 'EG' },
      { city_id: 'DXB', name: 'Dubai', country_code: 'AE' },
    ]);

    // Two hotels exist first; each moderator is linked to one of them (ACC-13 does this in the real app).
    admin = await (async () => {
      await insertUser('admin@example.com', { role: Role.ADMIN });
      return loginCookie('admin@example.com');
    })();
    hotelA = (await http().post('/api/hotels').set('Cookie', admin).send(validHotel()).expect(201)).body.id;
    hotelB = (await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ name: 'Other Hotel' })).expect(201)).body.id;

    await insertUser('user@example.com', { role: Role.USER });
    await insertUser('moda@example.com', { role: Role.HOTEL_MODERATOR, hotelId: new Types.ObjectId(hotelA) });
    await insertUser('modb@example.com', { role: Role.HOTEL_MODERATOR, hotelId: new Types.ObjectId(hotelB) });
    userCookie = await loginCookie('user@example.com');
    modA = await loginCookie('moda@example.com');
    modB = await loginCookie('modb@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  describe('POST /api/hotels', () => {
    it('admin creates a hotel; country comes from the city, hotel is active, id is a string', async () => {
      const res = await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ name: 'Cairo Palace', photos: [{ id: 'p1', url: '/uploads/hotels/p1.jpg' }] })).expect(201);
      expect(res.body).toMatchObject({
        name: 'Cairo Palace',
        cityId: 'CAI',
        countryCode: 'EG',
        starRating: 4,
        isActive: true,
        amenities: ['Wifi', 'Pool'],
        photos: [{ id: 'p1', url: '/uploads/hotels/p1.jpg' }],
      });
      expect(typeof res.body.id).toBe('string');
      expect(res.body._id).toBeUndefined();
      expect(res.body.nameKey).toBeUndefined();
      expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
    });

    it('trims text and drops duplicate amenities', async () => {
      const res = await http()
        .post('/api/hotels')
        .set('Cookie', admin)
        .send(validHotel({ name: '  Trim Inn ', amenities: ['Wifi', ' wifi', '', 'Gym'] }))
        .expect(201);
      expect(res.body.name).toBe('Trim Inn');
      expect(res.body.amenities).toEqual(['Wifi', 'Gym']);
    });

    it('400 with the error shape for invalid input', async () => {
      const res = await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ starRating: 6, name: '' })).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', message: 'Validation failed', path: '/api/hotels' });
      expect(res.body.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['name', 'starRating']));
    });

    it('400 for unknown fields (isActive cannot be set) and for a city that is not seeded', async () => {
      await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ isActive: false })).expect(400);
      const res = await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ name: 'Ghost', cityId: 'NOPE' })).expect(400);
      expect(res.body.details).toEqual([{ field: 'cityId', message: 'cityId must be a seeded city id' }]);
    });

    it('400 for photo urls that are not an /uploads/ path (external, scheme, traversal)', async () => {
      for (const url of ['https://evil.example/x.jpg', '//evil.example/x.jpg', 'javascript:alert(1)', '/uploads/../etc/passwd', '/other/x.jpg']) {
        const res = await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ name: 'Url Inn', photos: [{ id: 'p', url }] })).expect(400);
        expect(res.body.details[0].field).toBe('photos.0.url');
      }
    });

    it('400 for more than 5 photos', async () => {
      const photos = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, url: `/uploads/hotels/${i}.jpg` }));
      await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ name: 'Photo Inn', photos })).expect(400);
    });

    it('409 for the same name in the same city (case-insensitive), 201 in another city', async () => {
      await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ name: 'NILE VIEW HOTEL' })).expect(409);
      await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ cityId: 'DXB' })).expect(201);
    });

    it('401 without login, 403 for a user and for a hotel moderator', async () => {
      await http().post('/api/hotels').send(validHotel()).expect(401);
      await http().post('/api/hotels').set('Cookie', userCookie).send(validHotel({ name: 'X1' })).expect(403);
      await http().post('/api/hotels').set('Cookie', modA).send(validHotel({ name: 'X2' })).expect(403);
    });

    it('concurrent creates of the same hotel: exactly one wins', async () => {
      const codes = (
        await Promise.all(
          Array.from({ length: 5 }, () => http().post('/api/hotels').set('Cookie', admin).send(validHotel({ name: 'Race Hotel' }))),
        )
      ).map((r) => r.status);
      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(4);
    });
  });

  describe('PATCH /api/hotels/:id', () => {
    it('moderator edits their own hotel (partial update, country follows the city)', async () => {
      const res = await http()
        .patch(`/api/hotels/${hotelA}`)
        .set('Cookie', modA)
        .send({ description: 'Renovated.', starRating: 5, cityId: 'ALX', amenities: ['Spa'] })
        .expect(200);
      expect(res.body).toMatchObject({ id: hotelA, description: 'Renovated.', starRating: 5, cityId: 'ALX', countryCode: 'EG', amenities: ['Spa'], name: 'Nile View Hotel' });
      expect(res.body.isActive).toBe(true);
    });

    it('country follows the city across countries (Cairo -> Dubai gives AE)', async () => {
      const res = await http().patch(`/api/hotels/${hotelB}`).set('Cookie', modB).send({ cityId: 'DXB' }).expect(200);
      expect(res.body).toMatchObject({ cityId: 'DXB', countryCode: 'AE' });
    });

    it('rejects a non-upload photo url on PATCH', async () => {
      await http().patch(`/api/hotels/${hotelA}`).set('Cookie', modA).send({ photos: [{ id: 'x', url: 'https://evil.example/x.jpg' }] }).expect(400);
    });

    it('replaces photos and can clear them', async () => {
      const set = await http().patch(`/api/hotels/${hotelA}`).set('Cookie', modA).send({ photos: [{ id: 'a', url: '/uploads/hotels/a.png' }] }).expect(200);
      expect(set.body.photos).toEqual([{ id: 'a', url: '/uploads/hotels/a.png' }]);
      const cleared = await http().patch(`/api/hotels/${hotelA}`).set('Cookie', modA).send({ photos: [] }).expect(200);
      expect(cleared.body.photos).toEqual([]);
    });

    it('400 for an empty body, invalid values, unknown city, isActive, and >5 photos', async () => {
      await http().patch(`/api/hotels/${hotelA}`).set('Cookie', modA).send({}).expect(400);
      await http().patch(`/api/hotels/${hotelA}`).set('Cookie', modA).send({ starRating: 0 }).expect(400);
      await http().patch(`/api/hotels/${hotelA}`).set('Cookie', modA).send({ cityId: 'NOPE' }).expect(400);
      await http().patch(`/api/hotels/${hotelA}`).set('Cookie', modA).send({ isActive: false }).expect(400);
      const photos = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, url: `/uploads/hotels/${i}.jpg` }));
      await http().patch(`/api/hotels/${hotelA}`).set('Cookie', modA).send({ photos }).expect(400);
    });

    it("404 when editing another moderator's hotel, and the hotel is unchanged", async () => {
      await http().patch(`/api/hotels/${hotelB}`).set('Cookie', modA).send({ description: 'Hacked' }).expect(404);
      const ok = await http().patch(`/api/hotels/${hotelB}`).set('Cookie', modB).send({ address: 'New street 1' }).expect(200);
      expect(ok.body.description).toBe('Riverside hotel.');
    });

    it('404 for an unknown or malformed id', async () => {
      await http().patch(`/api/hotels/${new Types.ObjectId()}`).set('Cookie', modA).send({ description: 'x' }).expect(404);
      await http().patch('/api/hotels/not-an-id').set('Cookie', modA).send({ description: 'x' }).expect(404);
    });

    it('409 when renaming to a name already used in the same city', async () => {
      await http().post('/api/hotels').set('Cookie', admin).send(validHotel({ name: 'Taken Name', cityId: 'ALX' })).expect(201);
      await http().patch(`/api/hotels/${hotelA}`).set('Cookie', modA).send({ name: 'taken name' }).expect(409);
    });

    it('401 without login; 403 for a user and for an admin', async () => {
      await http().patch(`/api/hotels/${hotelA}`).send({ description: 'x' }).expect(401);
      await http().patch(`/api/hotels/${hotelA}`).set('Cookie', userCookie).send({ description: 'x' }).expect(403);
      await http().patch(`/api/hotels/${hotelA}`).set('Cookie', admin).send({ description: 'x' }).expect(403);
    });
  });
});
