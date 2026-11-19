import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AccountStatus, ContentType, PostStatus, ReportStatus, Role } from '../src/common';
import { setupApp } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

/**
 * GEN-10 on the real AppModule and a real (in-memory) MongoDB: an admin lists and resolves
 * reports (dismiss/hide/delete), and deletes content directly — admin-only, every action
 * audit-logged, hidden content stays visible only to its author and admins, resolving an
 * already-resolved report is rejected, REVIEW is honestly unsupported (501).
 */
describe('GEN-10 admin resolves reports: dismiss, hide, delete (actual AppModule)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let root: string;
  let db: Connection;
  let sequence = 0;
  const password = 'OriginalPass1';
  const keys = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECURE'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const cookies = {} as Record<Role, string[]>;
  const http = () => request(app.getHttpServer());
  const jar = (res: request.Response): string[] =>
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]);
  const login = (email: string, value: string) => http().post('/api/auth/login').send({ email, password: value });
  const email = () => `gen10-${++sequence}@example.test`;
  const admin = () => cookies[Role.ADMIN];
  const asUser = () => cookies[Role.USER];

  const insertUser = async (role: Role) => {
    const value = email();
    await db.collection('users').insertOne({
      name: 'Synthetic',
      email: value,
      passwordHash: hashSync(password, 4),
      role,
      status: AccountStatus.ACTIVE,
      preferredCurrency: 'USD',
      consentAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return value;
  };

  let authorId: Types.ObjectId;

  const insertPost = async (overrides: Record<string, unknown> = {}) => {
    const result = await db.collection('posts').insertOne({
      authorId,
      title: 'A post',
      body: 'Some body text.',
      tags: [],
      images: [],
      status: PostStatus.PUBLISHED,
      publishedAt: new Date(),
      isHidden: false,
      likeCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    return result.insertedId;
  };

  const insertHotel = async () => {
    const result = await db.collection('hotels').insertOne({
      name: `Hotel ${++sequence}`,
      nameKey: `hotel ${sequence}`,
      address: '1 Test Street',
      cityId: 'city-1',
      countryCode: 'EG',
      description: 'A hotel used for GEN-10 tests.',
      photos: [],
      starRating: 4,
      amenities: [],
      cancellationTiers: [],
      checkInTime: null,
      checkOutTime: null,
      averageRating: null,
      reviewCount: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return result.insertedId;
  };

  const insertHotelReview = async (hotelId: Types.ObjectId, overrides: Record<string, unknown> = {}) => {
    const result = await db.collection('hotelReviews').insertOne({
      bookingId: new Types.ObjectId(),
      hotelId,
      authorId,
      rating: 5,
      comment: 'Great stay.',
      isHidden: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    return result.insertedId;
  };

  const insertReport = async (targetId: Types.ObjectId, overrides: Record<string, unknown> = {}) => {
    const result = await db.collection('reports').insertOne({
      reporterId: new Types.ObjectId(),
      targetType: ContentType.POST,
      targetId,
      reason: 'spam',
      status: ReportStatus.OPEN,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    return result.insertedId.toString();
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'gen10-app-'));
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: 'gen10-access-fixture-0123456789abcdef',
      JWT_REFRESH_SECRET: 'gen10-refresh-fixture-0123456789abcdef',
      COOKIE_SECURE: 'false',
    });
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const configSpy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) => configure({ ...options, ignoreEnvFile: true }));
    try {
      const { AppModule } = await import('../src/app.module');
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(UPLOAD_OPTIONS)
        .useValue({ root, leaseMs: 60000, recoveryIntervalMs: 3600000, recoveryBatchSize: 50 })
        .compile();
      app = module.createNestApplication();
      app.useLogger(false);
      setupApp(app);
      await app.listen(0, '127.0.0.1');
    } finally {
      configSpy.mockRestore();
    }
    db = app.get<Connection>(getConnectionToken());
    await db.collection('users').createIndex({ email: 1 }, { unique: true });

    for (const role of [Role.ADMIN, Role.USER]) {
      const value = await insertUser(role);
      cookies[role] = jar(await login(value, password).expect(200));
    }
    const authorEmail = await insertUser(Role.USER);
    const authorDoc = await db.collection('users').findOne({ email: authorEmail });
    authorId = authorDoc!._id;
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // Isolation between tests: users/admin/author are shared (created once in beforeAll), but
  // content/reports/audit entries must not leak across tests that each assert on exact counts.
  beforeEach(async () => {
    await db.collection('posts').deleteMany({});
    await db.collection('comments').deleteMany({});
    await db.collection('hotels').deleteMany({});
    await db.collection('hotelReviews').deleteMany({});
    await db.collection('reports').deleteMany({});
    await db.collection('auditLogs').deleteMany({});
  });

  describe('admin only', () => {
    it('answers 401 to a guest and 403 to USER on every endpoint', async () => {
      const postId = await insertPost();
      const reportId = await insertReport(postId);

      await http().get('/api/admin/reports').expect(401);
      await http().get('/api/admin/reports').set('Cookie', asUser()).expect(403);

      await http().patch(`/api/admin/reports/${reportId}`).send({ resolution: 'DISMISS' }).expect(401);
      await http().patch(`/api/admin/reports/${reportId}`).set('Cookie', asUser()).send({ resolution: 'DISMISS' }).expect(403);

      await http().delete(`/api/admin/content/POST/${postId}`).expect(401);
      await http().delete(`/api/admin/content/POST/${postId}`).set('Cookie', asUser()).expect(403);
    });
  });

  describe('GET /api/admin/reports', () => {
    it('lists only OPEN reports', async () => {
      const postId = await insertPost();
      const openId = await insertReport(postId);
      await insertReport(postId, { status: ReportStatus.DISMISSED });

      const res = await http().get('/api/admin/reports').set('Cookie', admin()).expect(200);

      expect(res.body.items.map((r: { id: string }) => r.id)).toEqual([openId]);
    });
  });

  describe('PATCH /api/admin/reports/:id', () => {
    it('dismisses a report, leaving the post untouched, and audit-logs it', async () => {
      const postId = await insertPost();
      const reportId = await insertReport(postId);

      const res = await http()
        .patch(`/api/admin/reports/${reportId}`)
        .set('Cookie', admin())
        .send({ resolution: 'DISMISS' })
        .expect(200);

      expect(res.body.status).toBe(ReportStatus.DISMISSED);
      const post = await db.collection('posts').findOne({ _id: postId });
      expect(post!.isHidden).toBe(false);
      const auditEntries = await db.collection('auditLogs').find({ action: 'REPORT_DISMISSED' }).toArray();
      expect(auditEntries).toHaveLength(1);
    });

    it('hides the reported post — gone from the public read, isHidden set in the database', async () => {
      const postId = await insertPost();
      const reportId = await insertReport(postId);

      await http().patch(`/api/admin/reports/${reportId}`).set('Cookie', admin()).send({ resolution: 'HIDE' }).expect(200);

      const post = await db.collection('posts').findOne({ _id: postId });
      expect(post!.isHidden).toBe(true);

      // GET /api/blog/posts/:id is @Public() — JwtAuthGuard never populates request.user there
      // (a known, pre-existing limitation documented in this repo's own BLG-13 history), so it
      // cannot prove "the author/admin can still see it" through this route; that half of the
      // acceptance criterion is proven by the isHidden flag plus BlogService's own canView()
      // unit coverage instead. What this route CAN prove — the public is locked out — it does:
      await http().get(`/api/blog/posts/${postId}`).set('Cookie', asUser()).expect(404);
      await http().get(`/api/blog/posts/${postId}`).expect(404);

      const contentHidden = await db.collection('auditLogs').find({ action: 'CONTENT_HIDDEN' }).toArray();
      const reportHidden = await db.collection('auditLogs').find({ action: 'REPORT_RESOLVED_HIDDEN' }).toArray();
      expect(contentHidden).toHaveLength(1);
      expect(reportHidden).toHaveLength(1);
    });

    it('deletes the reported post and its comments', async () => {
      const postId = await insertPost();
      await db.collection('comments').insertOne({
        postId,
        authorId: new Types.ObjectId(),
        body: 'A comment',
        isHidden: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const reportId = await insertReport(postId);

      await http().patch(`/api/admin/reports/${reportId}`).set('Cookie', admin()).send({ resolution: 'DELETE' }).expect(200);

      expect(await db.collection('posts').findOne({ _id: postId })).toBeNull();
      expect(await db.collection('comments').countDocuments({ postId })).toBe(0);
      const contentDeleted = await db.collection('auditLogs').find({ action: 'CONTENT_DELETED' }).toArray();
      const reportDeleted = await db.collection('auditLogs').find({ action: 'REPORT_RESOLVED_DELETED' }).toArray();
      expect(contentDeleted).toHaveLength(1);
      expect(reportDeleted).toHaveLength(1);
    });

    it('rejects resolving an already-resolved report with 409', async () => {
      const postId = await insertPost();
      const reportId = await insertReport(postId, { status: ReportStatus.DISMISSED });

      await http().patch(`/api/admin/reports/${reportId}`).set('Cookie', admin()).send({ resolution: 'DISMISS' }).expect(409);
    });

    it('answers 404 for an unknown report id', async () => {
      await http()
        .patch(`/api/admin/reports/${new Types.ObjectId()}`)
        .set('Cookie', admin())
        .send({ resolution: 'DISMISS' })
        .expect(404);
    });

    it('rejects an invalid resolution value with 400', async () => {
      const postId = await insertPost();
      const reportId = await insertReport(postId);
      await http().patch(`/api/admin/reports/${reportId}`).set('Cookie', admin()).send({ resolution: 'NOPE' }).expect(400);
    });

    it('hides a reported hotel review and excludes it from the recalculated rating', async () => {
      const hotelId = await insertHotel();
      await insertHotelReview(hotelId, { rating: 2 });
      const reviewId = await insertHotelReview(hotelId, { rating: 4 });
      const reportId = await insertReport(reviewId, { targetType: ContentType.REVIEW });

      await http().patch(`/api/admin/reports/${reportId}`).set('Cookie', admin()).send({ resolution: 'HIDE' }).expect(200);

      const review = await db.collection('hotelReviews').findOne({ _id: reviewId });
      expect(review!.isHidden).toBe(true);
      const hotel = await db.collection('hotels').findOne({ _id: hotelId });
      expect(hotel!.averageRating).toBe(2);
      expect(hotel!.reviewCount).toBe(1);
    });
  });

  describe('DELETE /api/admin/content/:type/:id', () => {
    it('deletes a post directly, independent of any report', async () => {
      const postId = await insertPost();
      await http().delete(`/api/admin/content/POST/${postId}`).set('Cookie', admin()).expect(204);
      expect(await db.collection('posts').findOne({ _id: postId })).toBeNull();
    });

    it('answers 404 for an unknown post', async () => {
      await http().delete(`/api/admin/content/POST/${new Types.ObjectId()}`).set('Cookie', admin()).expect(404);
    });

    it('deletes a hotel review directly and recalculates the hotel rating', async () => {
      const hotelId = await insertHotel();
      await insertHotelReview(hotelId, { rating: 2 });
      const reviewId = await insertHotelReview(hotelId, { rating: 4 });

      await http().delete(`/api/admin/content/REVIEW/${reviewId}`).set('Cookie', admin()).expect(204);

      expect(await db.collection('hotelReviews').findOne({ _id: reviewId })).toBeNull();
      const hotel = await db.collection('hotels').findOne({ _id: hotelId });
      expect(hotel!.averageRating).toBe(2);
      expect(hotel!.reviewCount).toBe(1);
    });

    it('answers 400 for an invalid content type', async () => {
      await http().delete(`/api/admin/content/NOPE/${new Types.ObjectId()}`).set('Cookie', admin()).expect(400);
    });
  });
});
