import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import {
  ContentType,
  PostStatus,
  ReportStatus,
  Role,
  Visibility,
} from '../src/common';
import { setupApp } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/** GEN-09: POST /api/reports. Whole app, real posts and itineraries in an in-memory MongoDB. */
describe('Report content (GEN-09)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;
  const jwt = new JwtService({ secret: TEST_ACCESS_SECRET });

  const reports = () => db.collection('reports');
  const post = (body: unknown, cookie?: string) => {
    const r = request(app.getHttpServer()).post('/api/reports');
    if (cookie) r.set('Cookie', cookie);
    return r.send(body as object);
  };

  async function newUser(role: Role = Role.USER, extra: object = {}) {
    const _id = new Types.ObjectId();
    await db.collection('users').insertOne({
      _id,
      name: 'Reporter',
      email: `${_id.toHexString()}@reports.test`,
      passwordHash: 'x',
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    const token = await jwt.signAsync(
      { sub: _id.toHexString(), role, ...extra },
      { expiresIn: '10m' },
    );
    return { id: _id.toHexString(), cookie: `access_token=${token}` };
  }

  async function newPost(overrides: object = {}) {
    const _id = new Types.ObjectId();
    await db.collection('posts').insertOne({
      _id,
      authorId: new Types.ObjectId(),
      title: 'A post',
      body: 'Body',
      tags: [],
      images: [],
      status: PostStatus.PUBLISHED,
      isHidden: false,
      likeCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    return _id.toHexString();
  }

  async function newItinerary(overrides: object = {}) {
    const _id = new Types.ObjectId();
    await db.collection('itineraries').insertOne({
      _id,
      authorId: new Types.ObjectId(),
      title: 'A trip',
      countryCodes: ['EG'],
      visibility: Visibility.PUBLIC,
      isHidden: false,
      days: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    return _id.toHexString();
  }

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    // Set BEFORE AppModule is imported so nothing from backend/.env can win.
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    expect(process.env.MONGODB_URI).toMatch(/^mongodb:\/\/127\.0\.0\.1:/);

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    await db.model('Report').init(); // the unique index must exist before the tests run
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  afterEach(async () => {
    await reports().deleteMany({});
  });

  describe('happy path', () => {
    it('reports a published post: 201, status OPEN, reporter is the caller, reason trimmed', async () => {
      const user = await newUser();
      const postId = await newPost();
      const res = await post(
        {
          targetType: ContentType.POST,
          targetId: postId,
          reason: '  Spam links  ',
        },
        user.cookie,
      );
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        reporterId: user.id,
        targetType: 'POST',
        targetId: postId,
        reason: 'Spam links',
        status: 'OPEN',
        createdAt: expect.stringMatching(/Z$/),
      });
      const stored = await reports().find({}).toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0].status).toBe(ReportStatus.OPEN);
      expect(String(stored[0].reporterId)).toBe(user.id);
      expect(String(stored[0].targetId)).toBe(postId);
    });

    it('reports a public itinerary', async () => {
      const user = await newUser();
      const itineraryId = await newItinerary();
      const res = await post(
        {
          targetType: ContentType.ITINERARY,
          targetId: itineraryId,
          reason: 'Misleading',
        },
        user.cookie,
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        targetType: 'ITINERARY',
        targetId: itineraryId,
        status: 'OPEN',
      });
    });

    it('any logged-in account may report (admin and moderators too)', async () => {
      const postId = await newPost();
      const admin = await newUser(Role.ADMIN);
      const hotel = await newUser(Role.HOTEL_MODERATOR, {
        hotelId: new Types.ObjectId().toHexString(),
      });
      for (const who of [admin, hotel]) {
        const res = await post(
          { targetType: 'POST', targetId: postId, reason: 'x' },
          who.cookie,
        );
        expect(res.status).toBe(201);
      }
    });
  });

  describe('auth', () => {
    it('a guest gets 401 and nothing is stored', async () => {
      const postId = await newPost();
      const res = await post({
        targetType: 'POST',
        targetId: postId,
        reason: 'x',
      });
      expect(res.status).toBe(401);
      expect(await reports().countDocuments()).toBe(0);
    });
  });

  describe('validation (400, nothing stored)', () => {
    const detailsOf = (res: request.Response): string[] =>
      (res.body as { details: { field: string }[] }).details.map(
        (d) => d.field,
      );

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['only spaces', '    '],
      ['a number', 5],
      ['null', null],
    ])('reason is required: %s', async (_name, reason) => {
      const user = await newUser();
      const postId = await newPost();
      const res = await post(
        { targetType: 'POST', targetId: postId, reason },
        user.cookie,
      );
      expect(res.status).toBe(400);
      expect(detailsOf(res)).toContain('reason');
      expect(await reports().countDocuments()).toBe(0);
    });

    it('reason over 500 characters is rejected, exactly 500 is accepted', async () => {
      const user = await newUser();
      const postId = await newPost();
      const tooLong = await post(
        { targetType: 'POST', targetId: postId, reason: 'a'.repeat(501) },
        user.cookie,
      );
      expect(tooLong.status).toBe(400);
      expect(detailsOf(tooLong)).toContain('reason');
      const ok = await post(
        { targetType: 'POST', targetId: postId, reason: 'a'.repeat(500) },
        user.cookie,
      );
      expect(ok.status).toBe(201);
    });

    it('missing or unknown targetType and bad targetId are field-level errors', async () => {
      const user = await newUser();
      const res = await post({ targetId: 'nope', reason: 'x' }, user.cookie);
      expect(res.status).toBe(400);
      expect(detailsOf(res)).toEqual(
        expect.arrayContaining(['targetType', 'targetId']),
      );
      const wrongType = await post(
        {
          targetType: 'USER',
          targetId: new Types.ObjectId().toHexString(),
          reason: 'x',
        },
        user.cookie,
      );
      expect(wrongType.status).toBe(400);
      expect(detailsOf(wrongType)).toContain('targetType');
    });

    it('status and reporterId cannot be set from the body', async () => {
      const user = await newUser();
      const postId = await newPost();
      const res = await post(
        {
          targetType: 'POST',
          targetId: postId,
          reason: 'x',
          status: 'DISMISSED',
          reporterId: new Types.ObjectId().toHexString(),
        },
        user.cookie,
      );
      expect(res.status).toBe(400);
      expect(detailsOf(res)).toEqual(
        expect.arrayContaining(['status', 'reporterId']),
      );
      expect(await reports().countDocuments()).toBe(0);
    });
  });

  describe('the target must exist and be visible', () => {
    it('a post or itinerary that does not exist is a 404, nothing stored', async () => {
      const user = await newUser();
      for (const targetType of ['POST', 'ITINERARY']) {
        const res = await post(
          {
            targetType,
            targetId: new Types.ObjectId().toHexString(),
            reason: 'x',
          },
          user.cookie,
        );
        expect(res.status).toBe(404);
      }
      expect(await reports().countDocuments()).toBe(0);
    });

    it('an id of the wrong type is a 404 (a post id reported as an itinerary)', async () => {
      const user = await newUser();
      const postId = await newPost();
      const res = await post(
        { targetType: 'ITINERARY', targetId: postId, reason: 'x' },
        user.cookie,
      );
      expect(res.status).toBe(404);
    });

    it.each([
      ['a draft post', () => newPost({ status: PostStatus.DRAFT }), 'POST'],
      ['a hidden post', () => newPost({ isHidden: true }), 'POST'],
      [
        'a private itinerary',
        () => newItinerary({ visibility: Visibility.PRIVATE }),
        'ITINERARY',
      ],
      [
        'a hidden itinerary',
        () => newItinerary({ isHidden: true }),
        'ITINERARY',
      ],
    ])(
      'cannot be used to probe %s: 404',
      async (_name, make: () => Promise<string>, targetType) => {
        const user = await newUser();
        const targetId = await make();
        const res = await post(
          { targetType, targetId, reason: 'x' },
          user.cookie,
        );
        expect(res.status).toBe(404);
        expect(await reports().countDocuments()).toBe(0);
      },
    );

    it('COMMENT and REVIEW are valid types but cannot be reported yet: 400 on targetType', async () => {
      const user = await newUser();
      for (const targetType of ['COMMENT', 'REVIEW']) {
        const res = await post(
          {
            targetType,
            targetId: new Types.ObjectId().toHexString(),
            reason: 'x',
          },
          user.cookie,
        );
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          message: 'Validation failed',
          details: [{ field: 'targetType' }],
        });
      }
      expect(await reports().countDocuments()).toBe(0);
    });
  });

  describe('once per item per user', () => {
    it('the second report of the same item by the same user is a 409 with one row stored', async () => {
      const user = await newUser();
      const postId = await newPost();
      const body = { targetType: 'POST', targetId: postId, reason: 'first' };
      expect((await post(body, user.cookie)).status).toBe(201);
      const again = await post(
        { ...body, reason: 'a new reason' },
        user.cookie,
      );
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        statusCode: 409,
        details: [{ field: 'targetId' }],
      });
      const stored = await reports().find({}).toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0].reason).toBe('first');
    });

    it('ten parallel reports of the same item by the same user: one 201, nine 409, one row', async () => {
      const user = await newUser();
      const itineraryId = await newItinerary();
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          post(
            {
              targetType: 'ITINERARY',
              targetId: itineraryId,
              reason: 'parallel',
            },
            user.cookie,
          ),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(9);
      expect(await reports().countDocuments()).toBe(1);
    });

    it('different users can report the same item, and one user can report different items', async () => {
      const a = await newUser();
      const b = await newUser();
      const post1 = await newPost();
      const post2 = await newPost();
      const itinerary = await newItinerary();
      const send = (who: { cookie: string }, type: string, id: string) =>
        post({ targetType: type, targetId: id, reason: 'x' }, who.cookie);
      expect((await send(a, 'POST', post1)).status).toBe(201);
      expect((await send(b, 'POST', post1)).status).toBe(201);
      expect((await send(a, 'POST', post2)).status).toBe(201);
      expect((await send(a, 'ITINERARY', itinerary)).status).toBe(201);
      expect(await reports().countDocuments()).toBe(4);
    });
  });

  it('the unique index on reporter + type + target exists', async () => {
    const indexes = await reports().indexes();
    const unique = indexes.find(
      (i) => i.unique && 'reporterId' in (i.key as object),
    );
    expect(unique?.key).toEqual({ reporterId: 1, targetType: 1, targetId: 1 });
  });
});
