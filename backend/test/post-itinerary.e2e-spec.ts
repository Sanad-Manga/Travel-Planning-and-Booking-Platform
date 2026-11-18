import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { BlogModule } from '../src/blog/blog.module';
import { Role, Visibility } from '../src/common';
import configuration from '../src/config/configuration';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

// Starting the in-memory MongoDB can take longer than Jest's 5 s default (same as post-search.e2e-spec.ts).
jest.setTimeout(120000);

describe('BLG-13 attach an itinerary to a post PATCH /api/posts/:id/itinerary (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

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

  const insertItinerary = async (authorId: string, title: string, over: Record<string, unknown> = {}): Promise<string> => {
    const now = new Date();
    const res = await connection.collection('itineraries').insertOne({
      authorId: new Types.ObjectId(authorId),
      title,
      countryCodes: ['EG'],
      startDate: '2026-12-20',
      visibility: Visibility.PRIVATE,
      isHidden: false,
      days: [],
      createdAt: now,
      updatedAt: now,
      ...over,
    });
    return res.insertedId.toString();
  };

  const setItinerary = (id: string, changes: Record<string, unknown>) =>
    connection.collection('itineraries').updateOne({ _id: new Types.ObjectId(id) }, { $set: changes });

  const createPost = async (cookie: string): Promise<string> =>
    (await http().post('/api/posts').set('Cookie', cookie).send({ title: 'A trip', body: 'Some text.', status: 'PUBLISHED' }).expect(201)).body.id;

  const attach = (postId: string, cookie: string | null, body: Record<string, unknown>) => {
    const req = http().patch(`/api/posts/${postId}/itinerary`);
    return (cookie ? req.set('Cookie', cookie) : req).send(body);
  };

  const storedItineraryId = async (postId: string) =>
    (await connection.collection('posts').findOne({ _id: new Types.ObjectId(postId) }))?.itineraryId?.toString();

  let authorId: string;
  let otherId: string;
  let authorCookie: string;
  let otherCookie: string;

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

    authorId = await insertUser('author@example.com', 'Sara Ahmed');
    otherId = await insertUser('other@example.com', 'Omar Ali');
    authorCookie = await loginCookie('author@example.com');
    otherCookie = await loginCookie('other@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  it('the author attaches their own private itinerary; readers see it only once it is public', async () => {
    const postId = await createPost(authorCookie);
    const itineraryId = await insertItinerary(authorId, 'Cairo week');

    const res = await attach(postId, authorCookie, { itineraryId }).expect(200);
    expect(res.body).toMatchObject({ id: postId, itineraryId });

    // Private: a guest and another logged-in user see no itinerary.
    expect((await http().get(`/api/posts/${postId}`).expect(200)).body.itinerary).toBeNull();
    expect((await http().get(`/api/posts/${postId}`).set('Cookie', otherCookie).expect(200)).body.itinerary).toBeNull();

    // Public: everyone sees it.
    await setItinerary(itineraryId, { visibility: Visibility.PUBLIC });
    expect((await http().get(`/api/posts/${postId}`).expect(200)).body.itinerary).toMatchObject({
      id: itineraryId,
      authorId,
      title: 'Cairo week',
      dayCount: 0,
    });

    // Public but hidden by an admin: readers do not see it.
    await setItinerary(itineraryId, { isHidden: true });
    expect((await http().get(`/api/posts/${postId}`).expect(200)).body.itinerary).toBeNull();

    // Public again, but its author's account is no longer ACTIVE: not shown (same rule as ITN-20).
    await setItinerary(itineraryId, { isHidden: false });
    await connection.collection('users').updateOne({ _id: new Types.ObjectId(authorId) }, { $set: { status: 'SUSPENDED' } });
    expect((await http().get(`/api/posts/${postId}`).expect(200)).body.itinerary).toBeNull();
    await connection.collection('users').updateOne({ _id: new Types.ObjectId(authorId) }, { $set: { status: 'ACTIVE' } });
  });

  it("someone else's itinerary cannot be attached, even a public one (404) and the post is unchanged", async () => {
    const postId = await createPost(authorCookie);
    const foreign = await insertItinerary(otherId, 'Not mine', { visibility: Visibility.PUBLIC });
    const res = await attach(postId, authorCookie, { itineraryId: foreign }).expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, message: 'Itinerary not found' });
    expect(await storedItineraryId(postId)).toBeUndefined();

    await attach(postId, authorCookie, { itineraryId: new Types.ObjectId().toString() }).expect(404);
  });

  it("only the post's author can attach: another user gets 404, a guest 401", async () => {
    const postId = await createPost(authorCookie);
    const theirs = await insertItinerary(otherId, 'Their trip');
    const res = await attach(postId, otherCookie, { itineraryId: theirs }).expect(404);
    expect(res.body.message).toBe('Post not found');
    await attach(postId, null, { itineraryId: theirs }).expect(401);
    expect(await storedItineraryId(postId)).toBeUndefined();
  });

  it('an unknown or malformed post id is a 404', async () => {
    const mine = await insertItinerary(authorId, 'Mine');
    await attach(new Types.ObjectId().toString(), authorCookie, { itineraryId: mine }).expect(404);
    await attach('not-an-id', authorCookie, { itineraryId: mine }).expect(404);
  });

  it('validates the body: a missing or malformed itineraryId or an unknown field is a 400 with details', async () => {
    const postId = await createPost(authorCookie);
    const bad = await attach(postId, authorCookie, { itineraryId: 'abc' }).expect(400);
    expect(bad.body.details.map((d: { field: string }) => d.field)).toContain('itineraryId');
    await attach(postId, authorCookie, {}).expect(400);
    await attach(postId, authorCookie, { itineraryId: 42 }).expect(400);
    const mine = await insertItinerary(authorId, 'Mine');
    await attach(postId, authorCookie, { itineraryId: mine, extra: true }).expect(400);
  });

  it('null removes the attached itinerary', async () => {
    const postId = await createPost(authorCookie);
    const mine = await insertItinerary(authorId, 'Mine', { visibility: Visibility.PUBLIC });
    await attach(postId, authorCookie, { itineraryId: mine }).expect(200);
    const res = await attach(postId, authorCookie, { itineraryId: null }).expect(200);
    expect(res.body.itineraryId).toBeNull();
    expect(await storedItineraryId(postId)).toBeUndefined();
    expect((await http().get(`/api/posts/${postId}`).expect(200)).body.itinerary).toBeNull();
  });

  it('an itinerary deleted after it was attached shows as null', async () => {
    const postId = await createPost(authorCookie);
    const mine = await insertItinerary(authorId, 'Soon gone', { visibility: Visibility.PUBLIC });
    await attach(postId, authorCookie, { itineraryId: mine }).expect(200);
    expect((await http().get(`/api/posts/${postId}`).expect(200)).body.itinerary).toMatchObject({ id: mine });
    await connection.collection('itineraries').deleteOne({ _id: new Types.ObjectId(mine) });
    expect((await http().get(`/api/posts/${postId}`).expect(200)).body.itinerary).toBeNull();
  });

  it('itineraryId cannot be set through PATCH /api/posts/:id (only through this endpoint)', async () => {
    const postId = await createPost(authorCookie);
    const mine = await insertItinerary(authorId, 'Mine');
    await http().patch(`/api/posts/${postId}`).set('Cookie', authorCookie).send({ itineraryId: mine }).expect(400);
  });
});
