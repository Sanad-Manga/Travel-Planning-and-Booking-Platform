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
import { POST_EXCERPT_MAX_LENGTH, POST_SEARCH_MAX_LENGTH } from '../src/blog/blog.constants';
import { PostStatus, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

jest.setTimeout(120000);

describe('BLG-09 search published posts (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const search = (q: string, extra = '') => http().get(`/api/posts?q=${encodeURIComponent(q)}${extra}`);
  const titles = (res: { body: { items: { title: string }[] } }) => res.body.items.map((row) => row.title);

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

  /** Inserts a post straight into the collection, so counters, dates and flags are exact. */
  const insertPost = async (authorId: string, over: Record<string, unknown> = {}): Promise<string> => {
    const res = await connection.collection('posts').insertOne({
      authorId: new Types.ObjectId(authorId),
      title: 'A post',
      body: 'Some text.',
      tags: [],
      images: [],
      status: PostStatus.PUBLISHED,
      isHidden: false,
      likeCount: 0,
      commentCount: 0,
      publishedAt: new Date('2026-11-01T10:00:00Z'),
      createdAt: new Date('2026-11-01T10:00:00Z'),
      updatedAt: new Date('2026-11-01T10:00:00Z'),
      ...over,
    });
    return res.insertedId.toString();
  };

  let saraId: string;
  let omarId: string;
  let saraCookie: string;
  let omarCookie: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    // A replica set: liking and commenting use MongoDB transactions.
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
    await Promise.all([connection.model('Post').init(), connection.model('Comment').init(), connection.model('Like').init()]);

    saraId = await insertUser('sara@example.com', 'Sara Ahmed');
    omarId = await insertUser('omar@example.com', 'Omar Ali');
    saraCookie = await loginCookie('sara@example.com');
    omarCookie = await loginCookie('omar@example.com');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await connection.collection('posts').deleteMany({});
    await connection.collection('comments').deleteMany({});
    await connection.collection('likes').deleteMany({});
  });

  describe('what the keyword matches', () => {
    it('matches the title, a tag or the author name, case-insensitively, and nothing else', async () => {
      await insertPost(omarId, { title: 'Street food in Cairo' });
      await insertPost(omarId, { title: 'Weekend plans', tags: ['cairo'] });
      await insertPost(saraId, { title: 'Hotel tips' }); // matches "sara" by author only
      await insertPost(omarId, { title: 'Only the body talks', body: 'Cairo is lovely' });
      await insertPost(omarId, { title: 'Unrelated' });

      expect(titles(await search('CAIRO').expect(200)).sort()).toEqual(['Street food in Cairo', 'Weekend plans']);
      expect(titles(await search('sara').expect(200))).toEqual(['Hotel tips']);
      expect(titles(await search('ahm').expect(200))).toEqual(['Hotel tips']); // part of the name
      expect(titles(await search('unrel').expect(200))).toEqual(['Unrelated']); // part of a word
    });

    it('with several words, every word must match somewhere (title, tag or author)', async () => {
      await insertPost(omarId, { title: 'Street food in Cairo' });
      await insertPost(omarId, { title: 'Cairo museums' });
      await insertPost(saraId, { title: 'Food markets', tags: ['cairo'] });
      expect(titles(await search('cairo food').expect(200)).sort()).toEqual(['Food markets', 'Street food in Cairo']);
      expect(titles(await search('  cairo   omar  ').expect(200)).sort()).toEqual(['Cairo museums', 'Street food in Cairo']);
    });

    it('treats the keyword as plain text, not a regular expression', async () => {
      await insertPost(omarId, { title: 'Learning C++ on holiday' });
      await insertPost(omarId, { title: 'Cairo' });
      expect(titles(await search('c++').expect(200))).toEqual(['Learning C++ on holiday']);
      expect(titles(await search('.*').expect(200))).toEqual([]);
      expect((await search('(').expect(200)).body.total).toBe(0);
      expect((await search('[a-z]').expect(200)).body.total).toBe(0);
    });

    it('combines with the tag filter', async () => {
      await insertPost(omarId, { title: 'Cairo food', tags: ['food'] });
      await insertPost(omarId, { title: 'Cairo sights', tags: ['sights'] });
      expect(titles(await search('cairo', '&tag=food').expect(200))).toEqual(['Cairo food']);
    });
  });

  describe('drafts and hidden posts never appear', () => {
    it('leaves out drafts and hidden posts, even for their author and an admin-free guest', async () => {
      await insertPost(omarId, { title: 'Cairo published' });
      await insertPost(omarId, { title: 'Cairo draft', status: PostStatus.DRAFT });
      await insertPost(omarId, { title: 'Cairo hidden', isHidden: true });
      expect(titles(await search('cairo').expect(200))).toEqual(['Cairo published']);
      expect(titles(await search('cairo').set('Cookie', omarCookie).expect(200))).toEqual(['Cairo published']);
      expect((await search('cairo', '&limit=50').expect(200)).body.total).toBe(1);
    });

    it('does not find a draft or hidden post by its author name either', async () => {
      await insertPost(saraId, { title: 'Secret draft', status: PostStatus.DRAFT });
      await insertPost(saraId, { title: 'Moderated', isHidden: true });
      expect((await search('sara').expect(200)).body).toMatchObject({ items: [], total: 0 });
    });
  });

  describe('order: likes + comments descending, then newest first', () => {
    it('sorts by the sum of likes and comments, then by publication date, newest first', async () => {
      await insertPost(omarId, { title: 'Cairo A low old', likeCount: 1, commentCount: 0, publishedAt: new Date('2026-10-01T00:00:00Z') });
      await insertPost(omarId, { title: 'Cairo B top', likeCount: 2, commentCount: 5, publishedAt: new Date('2026-09-01T00:00:00Z') }); // 7
      await insertPost(omarId, { title: 'Cairo C tie newer', likeCount: 3, commentCount: 1, publishedAt: new Date('2026-11-10T00:00:00Z') }); // 4
      await insertPost(omarId, { title: 'Cairo D tie older', likeCount: 0, commentCount: 4, publishedAt: new Date('2026-11-02T00:00:00Z') }); // 4
      await insertPost(omarId, { title: 'Cairo E none newest', publishedAt: new Date('2026-11-15T00:00:00Z') }); // 0
      await insertPost(omarId, { title: 'Cairo F none older', publishedAt: new Date('2026-11-14T00:00:00Z') }); // 0
      const res = await search('cairo').expect(200);
      expect(titles(res)).toEqual([
        'Cairo B top',
        'Cairo C tie newer',
        'Cairo D tie older',
        'Cairo A low old',
        'Cairo E none newest',
        'Cairo F none older',
      ]);
      expect(res.body.items[0]).toMatchObject({ likeCount: 2, commentCount: 5 });
    });

    it('a real like and a real comment move a post up', async () => {
      const first = await insertPost(omarId, { title: 'Cairo first', publishedAt: new Date('2026-11-03T00:00:00Z') });
      const second = await insertPost(omarId, { title: 'Cairo second', publishedAt: new Date('2026-11-02T00:00:00Z') });
      expect(titles(await search('cairo').expect(200))).toEqual(['Cairo first', 'Cairo second']);
      await http().post(`/api/posts/${second}/like`).set('Cookie', saraCookie).expect(200);
      await http().post(`/api/posts/${second}/comments`).set('Cookie', saraCookie).send({ body: 'Nice' }).expect(201);
      expect(titles(await search('cairo').expect(200))).toEqual(['Cairo second', 'Cairo first']);
      await http().delete(`/api/posts/${second}/like`).set('Cookie', saraCookie).expect(200);
      await http().post(`/api/posts/${first}/like`).set('Cookie', saraCookie).expect(200);
      await http().post(`/api/posts/${first}/like`).set('Cookie', omarCookie).expect(200);
      expect(titles(await search('cairo').expect(200))).toEqual(['Cairo first', 'Cairo second']);
    });

    it('the plain list without q keeps the BLG-02 order (newest published first), not the score', async () => {
      await insertPost(omarId, { title: 'Popular but old', likeCount: 9, publishedAt: new Date('2026-10-01T00:00:00Z') });
      await insertPost(omarId, { title: 'New', publishedAt: new Date('2026-11-10T00:00:00Z') });
      expect(titles(await http().get('/api/posts').expect(200))).toEqual(['New', 'Popular but old']);
      expect(titles(await search('   ').expect(200))).toEqual(['New', 'Popular but old']); // a blank q is no search
    });
  });

  describe('result rows', () => {
    it('show title, author, date and an excerpt, and no full body or images', async () => {
      await insertPost(omarId, { title: 'Short one', body: 'Just a line.', tags: ['cairo'], publishedAt: new Date('2026-11-05T08:30:00Z') });
      const res = await search('short').expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        title: 'Short one',
        author: { id: omarId, name: 'Omar Ali' },
        tags: ['cairo'],
        publishedAt: '2026-11-05T08:30:00.000Z',
        excerpt: 'Just a line.',
        likeCount: 0,
        commentCount: 0,
      });
    });

    it('cuts a long body to the excerpt length with an ellipsis and collapses whitespace', async () => {
      const long = `Line one.\n\n   ${'word '.repeat(100)}`;
      await insertPost(omarId, { title: 'Long one', body: long });
      await insertPost(omarId, { title: 'Exact one', body: 'x'.repeat(POST_EXCERPT_MAX_LENGTH) });
      const res = await search('one').expect(200);
      const long_ = res.body.items.find((r: { title: string }) => r.title === 'Long one');
      const exact = res.body.items.find((r: { title: string }) => r.title === 'Exact one');
      expect(long_.excerpt.startsWith('Line one. word word')).toBe(true);
      expect(long_.excerpt.endsWith('…')).toBe(true);
      expect(long_.excerpt.length).toBeLessThanOrEqual(POST_EXCERPT_MAX_LENGTH + 1);
      expect(long_.excerpt).not.toMatch(/\s{2}/);
      expect(exact.excerpt).toBe('x'.repeat(POST_EXCERPT_MAX_LENGTH)); // not cut, so no ellipsis
      expect(res.body.items.every((r: Record<string, unknown>) => !('body' in r) && !('images' in r))).toBe(true);
    });

    it('the plain list and the tag list carry the excerpt too', async () => {
      await insertPost(omarId, { title: 'Tagged', body: 'Tagged body', tags: ['cairo'] });
      expect((await http().get('/api/posts').expect(200)).body.items[0].excerpt).toBe('Tagged body');
      expect((await http().get('/api/tags/cairo/posts').expect(200)).body.items[0].excerpt).toBe('Tagged body');
    });

    it('shows Unknown user when the author account no longer exists, and does not match it by name', async () => {
      await insertPost(new Types.ObjectId().toString(), { title: 'Orphan cairo' });
      const res = await search('cairo').expect(200);
      expect(res.body.items[0].author.name).toBe('Unknown user');
      expect(titles(await search('unknown').expect(200))).toEqual([]);
    });
  });

  describe('no match, pagination and bad input', () => {
    it('no match is 200 with an empty page, not an error', async () => {
      await insertPost(omarId, { title: 'Cairo' });
      const res = await search('zzzzzz').expect(200);
      expect(res.body).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
    });

    it('pages of 10 by default, with total and totalPages, and no row on two pages', async () => {
      for (let i = 0; i < 25; i++) {
        await insertPost(omarId, { title: `Cairo ${String(i).padStart(2, '0')}`, likeCount: i % 3, publishedAt: new Date(Date.UTC(2026, 10, 1, 0, i)) });
      }
      const p1 = await search('cairo').expect(200);
      const p2 = await search('cairo', '&page=2').expect(200);
      const p3 = await search('cairo', '&page=3').expect(200);
      const p4 = await search('cairo', '&page=4').expect(200);
      expect(p1.body).toMatchObject({ page: 1, limit: 10, total: 25, totalPages: 3 });
      expect([p1.body.items.length, p2.body.items.length, p3.body.items.length, p4.body.items.length]).toEqual([10, 10, 5, 0]);
      expect(p4.body).toMatchObject({ total: 25, totalPages: 3 });
      const all = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((r: { id: string }) => r.id);
      expect(new Set(all).size).toBe(25);
      const scores = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((r: { likeCount: number }) => r.likeCount);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      const small = await search('cairo', '&limit=5&page=2').expect(200);
      expect(small.body).toMatchObject({ page: 2, limit: 5, total: 25, totalPages: 5 });
    });

    it('rejects a keyword over the limit, bad paging and unknown query fields with 400', async () => {
      const long = await search('a'.repeat(POST_SEARCH_MAX_LENGTH + 1)).expect(400);
      expect(long.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
      expect(long.body.details.map((d: { field: string }) => d.field)).toContain('q');
      await search('a'.repeat(POST_SEARCH_MAX_LENGTH)).expect(200);
      await search('cairo', '&limit=51').expect(400);
      await search('cairo', '&page=0').expect(400);
      await http().get('/api/posts?q=a&q=b').expect(400); // q twice is an array, not text
      await http().get('/api/posts?search=cairo').expect(400);
    });

    it('is public: a guest and a logged-in user get the same result', async () => {
      await insertPost(omarId, { title: 'Cairo' });
      expect(titles(await search('cairo').expect(200))).toEqual(['Cairo']);
      expect(titles(await search('cairo').set('Cookie', saraCookie).expect(200))).toEqual(['Cairo']);
    });
  });
});
