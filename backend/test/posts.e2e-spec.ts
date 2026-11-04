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

describe('BLG-01 create post (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const validPost = (over: Record<string, unknown> = {}) => ({ title: 'Three days in Cairo', body: 'We started at the pyramids.', ...over });

  const insertUser = async (email: string, role: Role): Promise<string> => {
    const res = await connection.collection('users').insertOne({
      name: 'Seeded',
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

  let userId: string;
  let userCookie: string;
  let adminCookie: string;

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
    await connection.model('Post').init(); // build the indexes before the tests run

    userId = await insertUser('user@example.com', Role.USER);
    await insertUser('admin@example.com', Role.ADMIN);
    userCookie = await loginCookie('user@example.com');
    adminCookie = await loginCookie('admin@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  describe('POST /api/posts', () => {
    it('creates a DRAFT by default: author is the caller, isHidden false, no publishedAt, ISO dates, string id', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send(validPost()).expect(201);
      expect(res.body).toMatchObject({
        title: 'Three days in Cairo',
        body: 'We started at the pyramids.',
        authorId: userId,
        status: PostStatus.DRAFT,
        isHidden: false,
        tags: [],
        images: [],
      });
      expect(typeof res.body.id).toBe('string');
      expect(res.body.publishedAt).toBeUndefined();
      expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
      expect(res.body._id).toBeUndefined();
      expect(res.body.__v).toBeUndefined();
    });

    it('creates a PUBLISHED post and stores it in the posts collection with publishedAt', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ title: 'Published one', status: 'PUBLISHED' })).expect(201);
      expect(res.body.status).toBe(PostStatus.PUBLISHED);
      expect(new Date(res.body.publishedAt).toISOString()).toBe(res.body.publishedAt);
      const stored = await connection.collection('posts').findOne({ title: 'Published one' });
      expect(stored).toMatchObject({ status: 'PUBLISHED', isHidden: false });
      expect(stored?.authorId.toString()).toBe(userId);
      expect(stored?.publishedAt).toBeInstanceOf(Date);
    });

    it('an explicit DRAFT is saved as DRAFT', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ status: 'DRAFT' })).expect(201);
      expect(res.body.status).toBe(PostStatus.DRAFT);
    });

    it('any logged-in role may post (admin)', async () => {
      await http().post('/api/posts').set('Cookie', adminCookie).send(validPost()).expect(201);
    });

    it('trims title/body and normalises tags (trim, lowercase, dedupe, drop blanks)', async () => {
      const res = await http()
        .post('/api/posts')
        .set('Cookie', userCookie)
        .send(validPost({ title: '  Padded title  ', body: '  padded body ', tags: [' Cairo ', 'cairo', 'BUDGET', '  '] }))
        .expect(201);
      expect(res.body.title).toBe('Padded title');
      expect(res.body.body).toBe('padded body');
      expect(res.body.tags).toEqual(['cairo', 'budget']);
    });

    it('accepts up to 5 image references and returns them as {id,url}', async () => {
      const images = Array.from({ length: 5 }, (_, i) => ({ id: `img${i}`, url: `/uploads/posts/img${i}.jpg` }));
      const res = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ images })).expect(201);
      expect(res.body.images).toEqual(images);
    });

    it('rejects a guest with 401 and the shared error shape', async () => {
      const res = await http().post('/api/posts').send(validPost()).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, path: '/api/posts' });
    });

    it('missing title returns 400 with a field-level detail', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send({ body: 'only a body' }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed', path: '/api/posts' });
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain('title');
      expect(res.body.details[0]).toEqual(expect.objectContaining({ field: expect.any(String), message: expect.any(String) }));
    });

    it('missing body returns 400 with a field-level detail', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send({ title: 'only a title' }).expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain('body');
    });

    it('whitespace-only title and body are rejected, both reported', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send({ title: '   ', body: '\n ' }).expect(400);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['title', 'body']));
    });

    it('rejects too-long title and body', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send({ title: 'x'.repeat(151), body: 'y'.repeat(10001) }).expect(400);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['title', 'body']));
    });

    it('rejects more than 5 distinct tags and tags longer than 30 characters', async () => {
      const many = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).expect(400);
      expect(many.body.details[0].field).toBe('tags');
      const long = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ tags: ['t'.repeat(31)] })).expect(400);
      expect(long.body.details[0].field).toBe('tags');
    });

    it('duplicate tags count once toward the limit of 5', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ tags: ['a', 'A', 'b', 'c', 'd', 'e', 'e'] })).expect(201);
      expect(res.body.tags).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('rejects more than 5 images and malformed image references', async () => {
      const six = Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, url: `/uploads/posts/${i}.jpg` }));
      const tooMany = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ images: six })).expect(400);
      expect(tooMany.body.details[0].field).toBe('images');
      const bad = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ images: [{ id: 'x' }] })).expect(400);
      expect(bad.body.details[0].field).toBe('images.0.url');
    });

    it('rejects image urls that are not an /uploads/ path (external, scheme, traversal)', async () => {
      for (const url of ['https://evil.example/x.jpg', '//evil.example/x.jpg', 'javascript:alert(1)', '/uploads/../etc/passwd', '/other/x.jpg']) {
        const res = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ images: [{ id: 'i', url }] })).expect(400);
        expect(res.body.details[0].field).toBe('images.0.url');
      }
    });

    it('rejects an invalid status', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ status: 'ARCHIVED' })).expect(400);
      expect(res.body.details[0].field).toBe('status');
    });

    it('cannot set authorId or isHidden from the body (forbidNonWhitelisted)', async () => {
      const res = await http().post('/api/posts').set('Cookie', userCookie).send(validPost({ authorId: '6730a1f2c3d4e5f607182900', isHidden: true })).expect(400);
      const fields = res.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(expect.arrayContaining(['authorId', 'isHidden']));
    });

    it('creates the indexes needed by listing and search', async () => {
      const keys = (await connection.collection('posts').indexes()).map((i) => Object.keys(i.key).join(','));
      expect(keys).toEqual(expect.arrayContaining(['status,createdAt', 'authorId,status,createdAt', 'tags,status']));
    });
  });

  describe('GET /api/posts/mine (BLG-03)', () => {
    let readerId: string;
    let readerCookie: string;
    let otherCookie: string;
    let emptyCookie: string;

    const seedPosts = (
      authorId: string,
      count: number,
      over: Record<string, unknown> = {},
    ) =>
      connection.collection('posts').insertMany(
        Array.from({ length: count }, (_, i) => ({
          authorId: new Types.ObjectId(authorId),
          title: `Post ${i + 1}`,
          body: 'secret body',
          tags: ['x'],
          images: [],
          status: PostStatus.PUBLISHED,
          isHidden: false,
          likeCount: 0,
          commentCount: 0,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
          updatedAt: new Date(),
          ...over,
        })),
      );

    beforeAll(async () => {
      readerId = await insertUser('reader@example.com', Role.USER);
      await insertUser('other@example.com', Role.USER);
      readerCookie = await loginCookie('reader@example.com');
      otherCookie = await loginCookie('other@example.com');
      await insertUser('empty@example.com', Role.ADMIN);
      emptyCookie = await loginCookie('empty@example.com');
      await seedPosts(readerId, 12);
    });

    it('rejects guests with 401', async () => {
      await http().get('/api/posts/mine').expect(401);
    });

    it("returns the caller's own posts, newest first, page size 10 by default, with the pagination envelope", async () => {
      const res = await http()
        .get('/api/posts/mine')
        .set('Cookie', readerCookie)
        .expect(200);
      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      expect(res.body.items).toHaveLength(10);
      expect(res.body.items[0].title).toBe('Post 12');
      expect(res.body.items[9].title).toBe('Post 3');
    });

    it('page 2 holds the remaining rows; a page past the end is empty', async () => {
      const p2 = await http()
        .get('/api/posts/mine?page=2')
        .set('Cookie', readerCookie)
        .expect(200);
      expect(p2.body.items.map((i: { title: string }) => i.title)).toEqual([
        'Post 2',
        'Post 1',
      ]);
      const p3 = await http()
        .get('/api/posts/mine?page=3')
        .set('Cookie', readerCookie)
        .expect(200);
      expect(p3.body.items).toEqual([]);
    });

    it('each row shows id, title, status, date, like count and comment count, and no body, images or tags', async () => {
      const res = await http()
        .get('/api/posts/mine?limit=1')
        .set('Cookie', readerCookie)
        .expect(200);
      expect(res.body.items[0]).toEqual({
        id: expect.stringMatching(/^[a-f0-9]{24}$/),
        title: 'Post 12',
        status: PostStatus.PUBLISHED,
        isHidden: false,
        createdAt: '2026-01-01T00:11:00.000Z',
        likeCount: 0,
        commentCount: 0,
      });
    });

    it('shows the stored like and comment counts', async () => {
      await seedPosts(readerId, 1, {
        title: 'Popular',
        likeCount: 7,
        commentCount: 3,
        createdAt: new Date(Date.UTC(2027, 0, 1)),
      });
      const res = await http()
        .get('/api/posts/mine?limit=1')
        .set('Cookie', readerCookie)
        .expect(200);
      expect(res.body.items[0]).toMatchObject({
        title: 'Popular',
        likeCount: 7,
        commentCount: 3,
      });
      await connection.collection('posts').deleteOne({ title: 'Popular' });
    });

    it('includes drafts and hidden posts of the caller', async () => {
      await seedPosts(readerId, 1, {
        title: 'My draft',
        status: PostStatus.DRAFT,
        createdAt: new Date(Date.UTC(2027, 0, 1)),
      });
      await seedPosts(readerId, 1, {
        title: 'My hidden',
        isHidden: true,
        createdAt: new Date(Date.UTC(2027, 0, 2)),
      });
      const res = await http()
        .get('/api/posts/mine?limit=2')
        .set('Cookie', readerCookie)
        .expect(200);
      expect(res.body.items[0]).toMatchObject({
        title: 'My hidden',
        isHidden: true,
      });
      expect(res.body.items[1]).toMatchObject({
        title: 'My draft',
        status: PostStatus.DRAFT,
      });
      await connection
        .collection('posts')
        .deleteMany({ title: { $in: ['My draft', 'My hidden'] } });
    });

    it('a post created through POST /api/posts shows up straight away', async () => {
      await http()
        .post('/api/posts')
        .set('Cookie', otherCookie)
        .send(validPost({ title: 'Fresh draft' }))
        .expect(201);
      const res = await http()
        .get('/api/posts/mine')
        .set('Cookie', otherCookie)
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        title: 'Fresh draft',
        status: PostStatus.DRAFT,
      });
    });

    it("never returns another user's posts, whatever the role", async () => {
      const other = await http()
        .get('/api/posts/mine')
        .set('Cookie', otherCookie)
        .expect(200);
      expect(other.body.items.map((i: { title: string }) => i.title)).toEqual([
        'Fresh draft',
      ]);
      const empty = await http().get('/api/posts/mine').set('Cookie', emptyCookie).expect(200);
      expect(empty.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
    });

    it('rejects invalid page and limit with the field-level 400, and limit above 50', async () => {
      const bad = await http()
        .get('/api/posts/mine?page=0')
        .set('Cookie', readerCookie)
        .expect(400);
      expect(bad.body.details[0].field).toBe('page');
      await http()
        .get('/api/posts/mine?limit=51')
        .set('Cookie', readerCookie)
        .expect(400);
    });
  });
});
