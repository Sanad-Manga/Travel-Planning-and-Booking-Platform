import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { BlogModule } from '../src/blog/blog.module';
import { Role } from '../src/common';
import configuration from '../src/config/configuration';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

jest.setTimeout(120000);

describe('ACC-12 posts of a deactivated author are hidden (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());

  const insertUser = async (email: string, name: string, role: Role = Role.USER): Promise<string> => {
    const res = await connection.collection('users').insertOne({
      name,
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role,
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
  const publish = async (cookie: string, title: string, tags: string[] = []): Promise<string> =>
    (await http().post('/api/posts').set('Cookie', cookie).send({ title, body: 'Some text.', tags, status: 'PUBLISHED' }).expect(201)).body.id;
  const setStatus = (id: string, status: string) =>
    connection.collection('users').updateOne({ _id: new Types.ObjectId(id) }, { $set: { status } });
  const titles = (res: { body: { items: { title: string }[] } }) => res.body.items.map((i) => i.title).sort();

  let goneId: string;
  let goneCookie: string;
  let stayCookie: string;
  let readerCookie: string;
  let adminCookie: string;
  let gonePost: string;
  let stayPost: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
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

    goneId = await insertUser('gone@example.com', 'Gina Gone');
    await insertUser('stay@example.com', 'Sam Stay');
    await insertUser('reader@example.com', 'Rita Reader');
    await insertUser('admin@example.com', 'Ada Admin', Role.ADMIN);
    [goneCookie, stayCookie, readerCookie, adminCookie] = await Promise.all(
      ['gone@example.com', 'stay@example.com', 'reader@example.com', 'admin@example.com'].map(loginCookie),
    );
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await connection.collection('posts').deleteMany({});
    await connection.collection('comments').deleteMany({});
    await setStatus(goneId, 'ACTIVE');
    gonePost = await publish(goneCookie, 'Gone trip', ['cairo']);
    stayPost = await publish(stayCookie, 'Stay trip', ['cairo']);
    await http().post(`/api/posts/${gonePost}/comments`).set('Cookie', readerCookie).send({ body: 'nice' }).expect(201);
    await http().post(`/api/posts/${stayPost}/comments`).set('Cookie', goneCookie).send({ body: 'by gone' }).expect(201);
  });

  const deactivateThroughRoute = () => http().delete('/api/users/me').set('Cookie', goneCookie).send({ confirm: true }).expect(200);

  it('keeps the post public while the author is active (baseline)', async () => {
    expect(titles(await http().get('/api/posts').expect(200))).toEqual(['Gone trip', 'Stay trip']);
    await http().get(`/api/posts/${gonePost}`).expect(200);
  });

  it('removes the post from the list, the search, the tag list and the detail once the author self-deactivates', async () => {
    await deactivateThroughRoute();

    expect(titles(await http().get('/api/posts').expect(200))).toEqual(['Stay trip']);
    expect(titles(await http().get('/api/posts?q=trip').expect(200))).toEqual(['Stay trip']);
    expect(titles(await http().get('/api/posts?q=Gina').expect(200))).toEqual([]);
    expect(titles(await http().get('/api/tags/cairo/posts').expect(200))).toEqual(['Stay trip']);

    const hidden = await http().get(`/api/posts/${gonePost}`).expect(404);
    const unknown = await http().get(`/api/posts/${new Types.ObjectId().toString()}`).expect(404);
    expect({ ...hidden.body, path: '', timestamp: '' }).toEqual({ ...unknown.body, path: '', timestamp: '' });
    await http().get(`/api/posts/${gonePost}`).set('Cookie', readerCookie).expect(404);
    await http().get(`/api/posts/${gonePost}/comments`).set('Cookie', readerCookie).expect(404);
    await http().post(`/api/posts/${gonePost}/comments`).set('Cookie', readerCookie).send({ body: 'late' }).expect(404);
    await http().post(`/api/posts/${gonePost}/like`).set('Cookie', readerCookie).expect(404);
    await http().get(`/api/authors/${goneId}`).expect(404);
  });

  it('still lets an admin read the comments of the post (the detail route is public and never sees the caller, see BlogService unit test)', async () => {
    await deactivateThroughRoute();
    const res = await http().get(`/api/posts/${gonePost}/comments`).set('Cookie', adminCookie).expect(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('brings the post back when the account is ACTIVE again', async () => {
    await deactivateThroughRoute();
    await http().get(`/api/posts/${gonePost}`).expect(404);
    // No API route reactivates a DEACTIVATED account (the admin route only handles SUSPENDED), so the status is set directly.
    await setStatus(goneId, 'ACTIVE');
    expect(titles(await http().get('/api/posts').expect(200))).toEqual(['Gone trip', 'Stay trip']);
    await http().get(`/api/posts/${gonePost}`).expect(200);
  });

  it('keeps pagination totals correct with deactivated authors mixed in', async () => {
    for (let i = 0; i < 4; i++) await publish(stayCookie, `Stay extra ${i}`);
    for (let i = 0; i < 3; i++) await publish(goneCookie, `Gone extra ${i}`);
    await deactivateThroughRoute();

    const page1 = (await http().get('/api/posts?limit=2&page=1').expect(200)).body;
    const page3 = (await http().get('/api/posts?limit=2&page=3').expect(200)).body;
    expect(page1).toMatchObject({ total: 5, totalPages: 3, page: 1, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page3.items).toHaveLength(1);
    const search = (await http().get('/api/posts?q=trip&limit=1').expect(200)).body;
    expect(search).toMatchObject({ total: 1, totalPages: 1 });
  });

  it('leaves other authors unaffected and still shows the deactivated author comments as "Deleted user"', async () => {
    await deactivateThroughRoute();
    await http().get(`/api/posts/${stayPost}`).expect(200);
    const comments = await http().get(`/api/posts/${stayPost}/comments`).set('Cookie', readerCookie).expect(200);
    expect(comments.body.items[0].author.name).toBe('Deleted user');
  });
});
