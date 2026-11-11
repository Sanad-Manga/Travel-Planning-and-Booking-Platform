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
import { PostStatus, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

describe('BLG-08 tags on posts and tag listing (e2e)', () => {
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

  const createPost = async (cookie: string, over: Record<string, unknown> = {}) =>
    (await http().post('/api/posts').set('Cookie', cookie).send({ title: 'A post', body: 'Some text.', ...over }).expect(201)).body;
  const patch = (id: string, cookie: string, body: Record<string, unknown>) => http().patch(`/api/posts/${id}`).set('Cookie', cookie).send(body);
  const byTag = (tag: string, query = '') => http().get(`/api/tags/${encodeURIComponent(tag)}/posts${query}`);

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
    await connection.model('Post').init();

    await insertUser('author@example.com', 'Sara Ahmed');
    await insertUser('other@example.com', 'Omar Ali');
    authorCookie = await loginCookie('author@example.com');
    otherCookie = await loginCookie('other@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  describe('editing tags (PATCH /api/posts/:id)', () => {
    it('the author replaces the tags later; they are normalised (trim, lower-case, de-duplicated)', async () => {
      const post = await createPost(authorCookie, { tags: ['cairo'] });
      const res = await patch(post.id, authorCookie, { tags: [' Nile ', 'NILE', 'Food', ''] }).expect(200);
      expect(res.body.tags).toEqual(['nile', 'food']);
    });

    it('the author can add up to 5 tags of up to 30 characters, and clear them', async () => {
      const post = await createPost(authorCookie);
      const five = ['one', 'two', 'three', 'four', 't'.repeat(30)];
      expect((await patch(post.id, authorCookie, { tags: five }).expect(200)).body.tags).toEqual(five);
      expect((await patch(post.id, authorCookie, { tags: [] }).expect(200)).body.tags).toEqual([]);
    });

    it('rejects a 6th tag and a tag over 30 characters, and keeps the old tags', async () => {
      const post = await createPost(authorCookie, { tags: ['keep'] });
      const six = await patch(post.id, authorCookie, { tags: ['1', '2', '3', '4', '5', '6'] }).expect(400);
      expect(six.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
      expect(six.body.details.map((d: { field: string }) => d.field)).toContain('tags');
      const long = await patch(post.id, authorCookie, { tags: ['t'.repeat(31)] }).expect(400);
      expect(long.body.details.map((d: { field: string }) => d.field)).toContain('tags');
      await patch(post.id, authorCookie, { tags: [42] }).expect(400);
      await patch(post.id, authorCookie, { tags: 'cairo' }).expect(400);
      await patch(post.id, authorCookie, { tags: null }).expect(400);
      const stored = await connection.collection('posts').findOne({ _id: new Types.ObjectId(post.id) });
      expect(stored?.tags).toEqual(['keep']);
    });

    it("only the author can edit tags: someone else's post is a 404 and unchanged; guests get 401", async () => {
      const post = await createPost(authorCookie, { tags: ['mine'] });
      await patch(post.id, otherCookie, { tags: ['stolen'] }).expect(404);
      await http().patch(`/api/posts/${post.id}`).send({ tags: ['stolen'] }).expect(401);
      const stored = await connection.collection('posts').findOne({ _id: new Types.ObjectId(post.id) });
      expect(stored?.tags).toEqual(['mine']);
    });
  });

  describe('GET /api/tags/:tag/posts', () => {
    let publishedBeach: string;
    let secondBeach: string;
    let publishedCity: string;
    let draftBeach: string;
    let hiddenBeach: string;

    beforeAll(async () => {
      publishedBeach = (await createPost(authorCookie, { title: 'Beach one', tags: ['beach', 'sun'], status: PostStatus.PUBLISHED })).id;
      secondBeach = (await createPost(otherCookie, { title: 'Beach two', tags: ['Beach'], status: PostStatus.PUBLISHED })).id;
      publishedCity = (await createPost(authorCookie, { title: 'City', tags: ['city'], status: PostStatus.PUBLISHED })).id;
      draftBeach = (await createPost(authorCookie, { title: 'Draft beach', tags: ['beach'] })).id;
      hiddenBeach = (await createPost(authorCookie, { title: 'Hidden beach', tags: ['beach'], status: PostStatus.PUBLISHED })).id;
      await connection.collection('posts').updateOne({ _id: new Types.ObjectId(hiddenBeach) }, { $set: { isHidden: true } });
    });

    it('lists only published, visible posts with the tag, newest first, for a guest, with the BLG-02 row shape', async () => {
      const res = await byTag('beach').expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 2, totalPages: 1 });
      expect(res.body.items.map((p: { id: string }) => p.id)).toEqual([secondBeach, publishedBeach]);
      expect(res.body.items[1]).toMatchObject({
        id: publishedBeach,
        title: 'Beach one',
        author: { name: 'Sara Ahmed' },
        tags: ['beach', 'sun'],
        likeCount: 0,
        commentCount: 0,
      });
      expect(res.body.items[1].body).toBeUndefined();
      const ids = JSON.stringify(res.body.items);
      expect(ids).not.toContain(draftBeach);
      expect(ids).not.toContain(hiddenBeach);
      expect(ids).not.toContain(publishedCity);
    });

    it('is case-insensitive, trims the tag, and works for a tag with a space', async () => {
      expect((await byTag('BEACH').expect(200)).body.total).toBe(2);
      expect((await byTag('  beach  ').expect(200)).body.total).toBe(2);
      await createPost(authorCookie, { title: 'NY', tags: ['New York'], status: PostStatus.PUBLISHED });
      expect((await byTag('new york').expect(200)).body.total).toBe(1);
    });

    it('is paginated (page, limit, totalPages)', async () => {
      const first = await byTag('beach', '?limit=1&page=1').expect(200);
      expect(first.body).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
      expect(first.body.items.map((p: { id: string }) => p.id)).toEqual([secondBeach]);
      const second = await byTag('beach', '?limit=1&page=2').expect(200);
      expect(second.body.items.map((p: { id: string }) => p.id)).toEqual([publishedBeach]);
      await byTag('beach', '?limit=51').expect(400);
      await byTag('beach', '?page=0').expect(400);
    });

    it('an unknown tag is an empty list, not an error; a tag over 30 characters is a 400', async () => {
      expect((await byTag('nothing-here').expect(200)).body).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
      const res = await byTag('t'.repeat(31)).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
    });

    it('does not match part of a tag, and ignores regex characters', async () => {
      expect((await byTag('bea').expect(200)).body.total).toBe(0);
      expect((await byTag('.*').expect(200)).body.total).toBe(0);
    });

    it('follows edits: re-tagging moves a post between listings, un-publishing removes it', async () => {
      const id = (await createPost(authorCookie, { title: 'Mover', tags: ['alpha'], status: PostStatus.PUBLISHED })).id;
      expect((await byTag('alpha').expect(200)).body.items.map((p: { id: string }) => p.id)).toEqual([id]);
      await patch(id, authorCookie, { tags: ['omega'] }).expect(200);
      expect((await byTag('alpha').expect(200)).body.total).toBe(0);
      expect((await byTag('omega').expect(200)).body.items.map((p: { id: string }) => p.id)).toEqual([id]);
      await patch(id, authorCookie, { status: PostStatus.DRAFT }).expect(200);
      expect((await byTag('omega').expect(200)).body.total).toBe(0);
    });
  });
});
