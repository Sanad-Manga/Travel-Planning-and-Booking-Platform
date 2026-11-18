import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { Role, Visibility } from '../src/common';
import configuration from '../src/config/configuration';
import { FavouritesModule } from '../src/favourites/favourites.module';
import { setupApp } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

// Starting the in-memory MongoDB can take longer than Jest's 5 s default (same as post-search.e2e-spec.ts).
jest.setTimeout(120000);

describe('BON-02 favourites /api/favourites (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let uploadRoot: string;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());

  const insertUser = async (email: string, name: string): Promise<string> => {
    const res = await connection.collection('users').insertOne({
      name,
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.USER,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return res.insertedId.toString();
  };

  const loginCookie = async (email: string): Promise<string> => {
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return ((res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('access_token=')) as string).split(';')[0];
  };

  const insertHotel = async (name: string, isActive = true): Promise<string> => {
    // cityId + nameKey are unique together in the hotels collection, so each test hotel gets its own nameKey.
    const res = await connection
      .collection('hotels')
      .insertOne({ name, nameKey: name.toLowerCase(), cityId: '1', isActive, createdAt: new Date(), updatedAt: new Date() });
    return res.insertedId.toString();
  };

  const insertItinerary = async (authorId: string, title: string, over: Record<string, unknown> = {}): Promise<string> => {
    const now = new Date();
    const res = await connection.collection('itineraries').insertOne({
      authorId: new Types.ObjectId(authorId),
      title,
      countryCodes: ['EG'],
      startDate: '2026-12-20',
      visibility: Visibility.PUBLIC,
      isHidden: false,
      days: [],
      createdAt: now,
      updatedAt: now,
      ...over,
    });
    return res.insertedId.toString();
  };

  const add = (cookie: string | null, body: Record<string, unknown>) => {
    const req = http().post('/api/favourites');
    return (cookie ? req.set('Cookie', cookie) : req).send(body);
  };
  const list = (cookie: string, query = '') => http().get(`/api/favourites${query}`).set('Cookie', cookie);
  const countFor = (userId: string) => connection.collection('favourites').countDocuments({ userId: new Types.ObjectId(userId) });

  let userId: string;
  let otherId: string;
  let userCookie: string;
  let otherCookie: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryServer.create();
    uploadRoot = await fs.mkdtemp(join(tmpdir(), 'bon02-e2e-'));
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        FavouritesModule,
      ],
    })
      // ItinerariesModule and HotelsModule bring the shared upload service; keep its files in a temp folder.
      .overrideProvider(UPLOAD_OPTIONS)
      .useValue({ root: uploadRoot, leaseMs: 60_000, recoveryIntervalMs: 3_600_000, recoveryBatchSize: 50 })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('Favourite').init();

    userId = await insertUser('user@example.com', 'Sara Ahmed');
    otherId = await insertUser('other@example.com', 'Omar Ali');
    userCookie = await loginCookie('user@example.com');
    otherCookie = await loginCookie('other@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
    await fs.rm(uploadRoot, { recursive: true, force: true });
  });

  it('a guest gets 401 on every route', async () => {
    await add(null, { type: 'HOTEL', itemId: new Types.ObjectId().toString() }).expect(401);
    await http().get('/api/favourites').expect(401);
    await http().delete(`/api/favourites/${new Types.ObjectId().toString()}`).expect(401);
  });

  it('saves an active hotel and a public itinerary, and lists them newest first with their names', async () => {
    const hotelId = await insertHotel('Nile View Hotel');
    const itineraryId = await insertItinerary(otherId, 'Cairo week');

    const hotel = await add(userCookie, { type: 'HOTEL', itemId: hotelId }).expect(201);
    expect(hotel.body).toMatchObject({ type: 'HOTEL', itemId: hotelId, name: 'Nile View Hotel', available: true });
    const itinerary = await add(userCookie, { type: 'ITINERARY', itemId: itineraryId }).expect(201);
    expect(itinerary.body).toMatchObject({ type: 'ITINERARY', itemId: itineraryId, name: 'Cairo week', available: true });

    const res = await list(userCookie).expect(200);
    expect(res.body).toMatchObject({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(res.body.items.map((f: { itemId: string }) => f.itemId)).toEqual([itineraryId, hotelId]);
  });

  it('adding the same item twice does not duplicate it (200 with the same favourite)', async () => {
    const hotelId = await insertHotel('Twice Hotel');
    const before = await countFor(userId);
    const first = await add(userCookie, { type: 'HOTEL', itemId: hotelId }).expect(201);
    const second = await add(userCookie, { type: 'HOTEL', itemId: hotelId }).expect(200);
    expect(second.body.id).toBe(first.body.id);
    // Two requests at the same time: still one row.
    const itineraryId = await insertItinerary(otherId, 'Race trip');
    const results = await Promise.all([1, 2, 3].map(() => add(userCookie, { type: 'ITINERARY', itemId: itineraryId })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(await countFor(userId)).toBe(before + 2);
  });

  it('only existing hotels and public itineraries can be added (404 otherwise)', async () => {
    const before = await countFor(userId);
    const inactiveHotel = await insertHotel('Closed Hotel', false);
    const privateIt = await insertItinerary(otherId, 'Private', { visibility: Visibility.PRIVATE });
    const hiddenIt = await insertItinerary(otherId, 'Hidden', { isHidden: true });
    const unknown = new Types.ObjectId().toString();

    expect((await add(userCookie, { type: 'HOTEL', itemId: unknown }).expect(404)).body.message).toBe('Hotel not found');
    await add(userCookie, { type: 'HOTEL', itemId: inactiveHotel }).expect(404);
    expect((await add(userCookie, { type: 'ITINERARY', itemId: unknown }).expect(404)).body.message).toBe('Itinerary not found');
    await add(userCookie, { type: 'ITINERARY', itemId: privateIt }).expect(404);
    await add(userCookie, { type: 'ITINERARY', itemId: hiddenIt }).expect(404);
    // A hotel id sent as an itinerary (and the other way round) is not found either.
    const hotelId = await insertHotel('Typed Hotel');
    await add(userCookie, { type: 'ITINERARY', itemId: hotelId }).expect(404);
    expect(await countFor(userId)).toBe(before);
  });

  it('validates the body: bad type, malformed itemId, missing or unknown fields give 400 with details', async () => {
    const bad = await add(userCookie, { type: 'FLIGHT', itemId: 'abc' }).expect(400);
    expect(bad.body.details.map((d: { field: string }) => d.field).sort()).toEqual(['itemId', 'type']);
    await add(userCookie, {}).expect(400);
    await add(userCookie, { type: 'HOTEL', itemId: new Types.ObjectId().toString(), extra: 1 }).expect(400);
    await list(userCookie, '?limit=51').expect(400);
  });

  it("a user sees only their own list, and cannot remove someone else's favourite", async () => {
    const hotelId = await insertHotel('Other Hotel');
    const theirs = await add(otherCookie, { type: 'HOTEL', itemId: hotelId }).expect(201);

    const mine = await list(userCookie, '?limit=50').expect(200);
    expect(mine.body.items.map((f: { id: string }) => f.id)).not.toContain(theirs.body.id);
    const other = await list(otherCookie).expect(200);
    expect(other.body).toMatchObject({ total: 1 });
    expect(other.body.items[0].id).toBe(theirs.body.id);

    await http().delete(`/api/favourites/${theirs.body.id}`).set('Cookie', userCookie).expect(404);
    expect((await list(otherCookie).expect(200)).body.total).toBe(1);
  });

  it('removes my favourite; unknown or malformed id is 404', async () => {
    const hotelId = await insertHotel('Remove Hotel');
    const fav = await add(otherCookie, { type: 'HOTEL', itemId: hotelId }).expect(201);
    await http().delete(`/api/favourites/${fav.body.id}`).set('Cookie', otherCookie).expect(204);
    await http().delete(`/api/favourites/${fav.body.id}`).set('Cookie', otherCookie).expect(404);
    await http().delete('/api/favourites/not-an-id').set('Cookie', otherCookie).expect(404);
  });

  it('an item that is no longer available stays listed with available=false and no name', async () => {
    const hotelId = await insertHotel('Soon Closed');
    const itineraryId = await insertItinerary(otherId, 'Soon Private');
    const cookie = await (async () => {
      await insertUser('third@example.com', 'Third User');
      return loginCookie('third@example.com');
    })();
    await add(cookie, { type: 'HOTEL', itemId: hotelId }).expect(201);
    await add(cookie, { type: 'ITINERARY', itemId: itineraryId }).expect(201);

    await connection.collection('hotels').updateOne({ _id: new Types.ObjectId(hotelId) }, { $set: { isActive: false } });
    await connection.collection('itineraries').updateOne({ _id: new Types.ObjectId(itineraryId) }, { $set: { visibility: Visibility.PRIVATE } });

    const res = await list(cookie).expect(200);
    expect(res.body.items).toHaveLength(2);
    for (const item of res.body.items) {
      expect(item).toMatchObject({ available: false, name: null });
    }
    expect(JSON.stringify(res.body)).not.toContain('Soon Private');
  });
});
