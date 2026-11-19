import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { BlogModule } from '../src/blog/blog.module';
import { AccountStatus, PostStatus, Role, Visibility } from '../src/common';
import configuration from '../src/config/configuration';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

// Starting the in-memory MongoDB can take longer than Jest's 5 s default (same as post-search.e2e-spec.ts).
jest.setTimeout(120000);

describe('BLG-12 public author page GET /api/authors/:id (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const http = () => request(app.getHttpServer());
  const JOINED = new Date('2026-10-01T09:00:00.000Z');

  const insertUser = async (name: string, status: AccountStatus): Promise<string> => {
    const res = await connection.collection('users').insertOne({
      name,
      email: `${name.replace(/\s/g, '').toLowerCase()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: Role.USER,
      status,
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: JOINED,
      updatedAt: JOINED,
    });
    return res.insertedId.toString();
  };

  const insertPost = async (authorId: string, title: string, over: Record<string, unknown> = {}) => {
    const now = new Date();
    await connection.collection('posts').insertOne({
      authorId: new Types.ObjectId(authorId),
      title,
      body: 'Some text.',
      tags: [],
      images: [],
      status: PostStatus.PUBLISHED,
      publishedAt: now,
      isHidden: false,
      likeCount: 0,
      commentCount: 0,
      createdAt: now,
      updatedAt: now,
      ...over,
    });
  };

  const insertItinerary = async (authorId: string, title: string, over: Record<string, unknown> = {}) => {
    const now = new Date();
    await connection.collection('itineraries').insertOne({
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
  };

  let authorId: string;
  let suspendedId: string;
  let deactivatedId: string;

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
        BlogModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());

    authorId = await insertUser('Sara Ahmed', AccountStatus.ACTIVE);
    const otherId = await insertUser('Omar Ali', AccountStatus.ACTIVE);
    suspendedId = await insertUser('Suspended Sam', AccountStatus.SUSPENDED);
    deactivatedId = await insertUser('Gone Gina', AccountStatus.DEACTIVATED);

    await insertPost(authorId, 'Published visible', { publishedAt: new Date('2026-11-02T00:00:00Z') });
    await insertPost(authorId, 'Published older', { publishedAt: new Date('2026-11-01T00:00:00Z') });
    await insertPost(authorId, 'Draft post', { status: PostStatus.DRAFT, publishedAt: undefined });
    await insertPost(authorId, 'Hidden post', { isHidden: true });
    await insertPost(otherId, 'Someone else');

    await insertItinerary(authorId, 'Public trip');
    await insertItinerary(authorId, 'Private trip', { visibility: Visibility.PRIVATE });
    await insertItinerary(authorId, 'Hidden trip', { isHidden: true });
    await insertItinerary(otherId, 'Other trip');

    await insertPost(suspendedId, 'Suspended post');
    await insertItinerary(suspendedId, 'Suspended trip');
    await insertPost(deactivatedId, 'Deactivated post');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  it('a guest (no cookie) opens the page: name, join date, published posts and public itineraries only', async () => {
    const res = await http().get(`/api/authors/${authorId}`).expect(200);
    expect(res.body).toMatchObject({ id: authorId, name: 'Sara Ahmed', joinedAt: JOINED.toISOString() });

    // Draft, hidden and other authors' posts are left out; newest published first.
    expect(res.body.posts).toMatchObject({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(res.body.posts.items.map((p: { title: string }) => p.title)).toEqual(['Published visible', 'Published older']);
    expect(res.body.posts.items[0].author).toEqual({ id: authorId, name: 'Sara Ahmed' });

    // Private, hidden and other authors' itineraries are left out.
    expect(res.body.itineraries).toMatchObject({ page: 1, limit: 10, total: 1, totalPages: 1 });
    expect(res.body.itineraries.items.map((i: { title: string }) => i.title)).toEqual(['Public trip']);
  });

  it('returns no private user data (only id, name and join date)', async () => {
    const res = await http().get(`/api/authors/${authorId}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'itineraries', 'joinedAt', 'name', 'posts']);
    const text = JSON.stringify(res.body);
    for (const secret of ['email', 'example.com', 'role', 'status', 'passwordHash', 'not-a-real-hash', 'token']) {
      expect(text).not.toContain(secret);
    }
  });

  it('page and limit apply to both lists', async () => {
    const res = await http().get(`/api/authors/${authorId}?page=2&limit=1`).expect(200);
    expect(res.body.posts).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.posts.items.map((p: { title: string }) => p.title)).toEqual(['Published older']);
    expect(res.body.itineraries).toMatchObject({ page: 2, limit: 1, total: 1, items: [] });
  });

  it('rejects an invalid page or limit with 400', async () => {
    await http().get(`/api/authors/${authorId}?limit=51`).expect(400);
    await http().get(`/api/authors/${authorId}?page=0`).expect(400);
  });

  it('a deactivated author is a 404', async () => {
    const res = await http().get(`/api/authors/${deactivatedId}`).expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, message: 'Author not found' });
  });

  it('an unknown or malformed id is a 404', async () => {
    await http().get(`/api/authors/${new Types.ObjectId().toString()}`).expect(404);
    await http().get('/api/authors/not-an-id').expect(404);
  });

  it('a suspended author shows posts but no itineraries (public itineraries need an ACTIVE author, ITN-20)', async () => {
    const res = await http().get(`/api/authors/${suspendedId}`).expect(200);
    expect(res.body.posts.items.map((p: { title: string }) => p.title)).toEqual(['Suspended post']);
    expect(res.body.itineraries).toMatchObject({ total: 0, items: [] });
  });
});
