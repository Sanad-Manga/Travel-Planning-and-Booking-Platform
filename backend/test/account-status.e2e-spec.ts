import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AuditService } from '../src/audit/audit.service';
import { AccountStatus, NotificationType, Role } from '../src/common';
import { NotificationsService } from '../src/notifications/notifications.service';
import { setupApp, setupSwagger } from '../src/setup-app';
import { User } from '../src/users/schemas/user.schema';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

describe('ACC-16 actual AppModule registration, transitions and ACC-14 regression', () => {
  let app: INestApplication,
    mongo: MongoMemoryServer,
    root: string,
    db: Connection,
    users: Model<User>;
  let targetId: string, adminId: string, passwordHash: string, email: string;
  const cookies = {} as Record<Role, string>;
  const secret = 'acc16-application-access-0123456789abcdef';
  const password = 'Acc16ApplicationFixture123';
  const envKeys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  const newId = () => new Types.ObjectId().toString();
  const account = async (role = Role.USER, status = AccountStatus.ACTIVE) =>
    users.create({
      name: 'Application Status Fixture',
      email: `${newId()}@example.test`,
      passwordHash,
      role,
      status,
      consentAcceptedAt: new Date('2026-11-01'),
      preferredCurrency: 'USD',
      phone: '+1234567890',
    });
  const patch = (
    method: 'suspend' | 'reactivate',
    id = targetId,
    cookie = cookies[Role.ADMIN],
  ) =>
    request(app.getHttpServer())
      .patch(`/api/admin/accounts/${id}/${method}`)
      .set('Cookie', cookie);
  const list = (query: Record<string, unknown>) =>
    request(app.getHttpServer())
      .get('/api/admin/accounts')
      .set('Cookie', cookies[Role.ADMIN])
      .query(query);
  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'acc16-app-'));
    mongo = await MongoMemoryServer.create();
    passwordHash = await hash(password, 4);
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: 'acc16-application-refresh-0123456789abcdef',
      COOKIE_SECURE: 'false',
    });
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const configSpy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        configure({ ...options, ignoreEnvFile: true }),
      );
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UPLOAD_OPTIONS)
      .useValue({
        root,
        leaseMs: 60000,
        recoveryIntervalMs: 3600000,
        recoveryBatchSize: 50,
      })
      .compile();
    configSpy.mockRestore();
    app = module.createNestApplication();
    app.useLogger(false);
    setupApp(app);
    setupSwagger(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(getConnectionToken());
    users = db.model<User>(User.name);
    await users.init();
    for (const role of Object.values(Role)) {
      const user = await account(role);
      if (role === Role.ADMIN) adminId = user._id.toString();
      cookies[role] =
        `access_token=${new JwtService().sign({ sub: user._id.toString(), role }, { secret, expiresIn: '15m' })}`;
    }
    // Guarantee a full default page without relying on other tests or real accounts.
    for (let i = 0; i < 8; i++) await account();
  });
  beforeEach(async () => {
    const target = await account();
    targetId = target._id.toString();
    email = target.email;
    await db.collection('auditLogs').deleteMany({});
    await db.collection('notifications').deleteMany({});
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it('registers both PATCH routes and returns safe DTOs with audits and both notification types', async () => {
    expect((await patch('suspend').expect(200)).body).toEqual({
      id: targetId,
      status: AccountStatus.SUSPENDED,
    });
    expect((await patch('reactivate').expect(200)).body).toEqual({
      id: targetId,
      status: AccountStatus.ACTIVE,
    });
    const audits = await db
      .collection('auditLogs')
      .find({ targetId })
      .sort({ _id: 1 })
      .toArray();
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      actorId: adminId,
      targetType: 'User',
      targetId,
      action: 'USER_SUSPENDED',
      details: { before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED' } },
    });
    expect(audits[1]).toMatchObject({
      actorId: adminId,
      targetId,
      action: 'USER_REACTIVATED',
      details: { before: { status: 'SUSPENDED' }, after: { status: 'ACTIVE' } },
    });
    const notices = await db
      .collection('notifications')
      .find({ userId: new Types.ObjectId(targetId) })
      .sort({ _id: 1 })
      .toArray();
    expect(notices).toHaveLength(2);
    expect(notices[0].type).toBe(NotificationType.ACCOUNT_SUSPENDED);
    expect(notices[1].type).toBe(NotificationType.ACCOUNT_REACTIVATED);
  });
  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'returns 403 to authenticated %s on both routes',
    async (role) => {
      for (const method of ['suspend', 'reactivate'] as const)
        await patch(method, targetId, cookies[role]).expect(403);
      expect((await users.findById(targetId))!.status).toBe(
        AccountStatus.ACTIVE,
      );
      expect(
        await db.collection('auditLogs').countDocuments({ targetId }),
      ).toBe(0);
    },
  );
  it('returns 401 without authentication on all three admin-account endpoints', async () => {
    await request(app.getHttpServer()).get('/api/admin/accounts').expect(401);
    for (const method of ['suspend', 'reactivate'])
      await request(app.getHttpServer())
        .patch(`/api/admin/accounts/${targetId}/${method}`)
        .expect(401);
  });
  it('blocks login and an existing access cookie while suspended and restores both after reactivation', async () => {
    const login = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password });
    const active = await login().expect(200);
    const oldCookie = (active.headers['set-cookie'] as unknown as string[])
      .find((value) => value.startsWith('access_token='))!
      .split(';')[0];
    const me = () =>
      request(app.getHttpServer()).get('/api/auth/me').set('Cookie', oldCookie);
    await me().expect(200);
    await patch('suspend').expect(200);
    expect((await login().expect(403)).body.message).toBe('Account suspended');
    await me().expect(401);
    await patch('reactivate').expect(200);
    await login().expect(200);
    await me().expect(200);
  });
  it('preserves account fields, bookings/payments/content and public post visibility through both changes', async () => {
    const names = [
      'flightBookings',
      'hotelBookings',
      'payments',
      'comments',
      'reviews',
      'itineraries',
    ];
    const snapshots = new Map<string, unknown[]>();
    for (const name of names) {
      await db.collection(name).insertOne({
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(targetId),
        status: name.endsWith('Bookings') ? 'CONFIRMED' : 'fixture',
        isHidden: false,
        fixture: targetId,
      });
      snapshots.set(
        name,
        await db.collection(name).find({ fixture: targetId }).toArray(),
      );
    }
    const postId = new Types.ObjectId();
    const createdAt = new Date();
    await db.collection('posts').insertOne({
      _id: postId,
      authorId: new Types.ObjectId(targetId),
      title: 'Preserved public post',
      body: 'Synthetic public content',
      tags: [],
      images: [],
      status: 'PUBLISHED',
      publishedAt: createdAt,
      isHidden: false,
      likeCount: 0,
      commentCount: 0,
      createdAt,
      updatedAt: createdAt,
    });
    const post = await db.collection('posts').findOne({ _id: postId });
    const before = (await users.collection.findOne({
      _id: new Types.ObjectId(targetId),
    }))!;
    for (const method of ['suspend', 'reactivate'] as const) {
      await patch(method).expect(200);
      const after = (await users.collection.findOne({
        _id: new Types.ObjectId(targetId),
      }))!;
      const expected = { ...before };
      delete after.status;
      delete after.updatedAt;
      delete expected.status;
      delete expected.updatedAt;
      expect(after).toEqual(expected);
      for (const name of names)
        expect(
          await db.collection(name).find({ fixture: targetId }).toArray(),
        ).toEqual(snapshots.get(name));
      expect(await db.collection('posts').findOne({ _id: postId })).toEqual(
        post,
      );
      const visible = await request(app.getHttpServer())
        .get(`/api/posts/${postId}`)
        .expect(200);
      expect(visible.body.id).toBe(postId.toString());
    }
  });
  it('accepts concurrent/repeated requests with one actual transition and no duplicate effects', async () => {
    for (const method of ['suspend', 'reactivate'] as const) {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => patch(method)),
      );
      expect(results.filter((res) => res.status === 200)).toHaveLength(4);
      const before = await users.collection.findOne({
        _id: new Types.ObjectId(targetId),
      });
      await patch(method).expect(200);
      expect(
        await users.collection.findOne({ _id: new Types.ObjectId(targetId) }),
      ).toEqual(before);
    }
    expect(await db.collection('auditLogs').countDocuments({ targetId })).toBe(
      2,
    );
    expect(
      await db
        .collection('notifications')
        .countDocuments({ userId: new Types.ObjectId(targetId) }),
    ).toBe(2);
  });
  it('rejects invalid IDs, missing accounts, invalid states and untrusted body overrides', async () => {
    for (const method of ['suspend', 'reactivate'] as const) {
      await patch(method, 'invalid').expect(400);
      await patch(method, newId()).expect(404);
      for (const body of [
        { status: 'ACTIVE' },
        { role: 'ADMIN' },
        { id: adminId },
      ])
        await patch(method).send(body).expect(400);
    }
    await patch('reactivate').expect(200);
    const deactivated = await account(Role.USER, AccountStatus.DEACTIVATED);
    for (const method of ['suspend', 'reactivate'] as const)
      await patch(method, deactivated._id.toString()).expect(409);
    expect((await users.findById(targetId))!.status).toBe(AccountStatus.ACTIVE);
    expect(await db.collection('auditLogs').countDocuments()).toBe(0);
    expect(await db.collection('notifications').countDocuments()).toBe(0);
  });
  it.each([Role.ADMIN, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'rejects target role %s without mutation',
    async (role) => {
      const target = await account(role);
      const before = await users.collection.findOne({ _id: target._id });
      for (const method of ['suspend', 'reactivate'] as const)
        await patch(method, target._id.toString()).expect(409);
      expect(await users.collection.findOne({ _id: target._id })).toEqual(
        before,
      );
    },
  );
  it('keeps ACC-14 defaults, projection, pagination and combined status filters working after each transition', async () => {
    const page = await list({}).expect(200);
    expect(page.body).toMatchObject({
      page: 1,
      limit: 10,
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
    expect(page.body.items).toHaveLength(10);
    await list({ limit: 51 }).expect(400);
    for (const method of ['suspend', 'reactivate'] as const) {
      const status =
        method === 'suspend' ? AccountStatus.SUSPENDED : AccountStatus.ACTIVE;
      await patch(method).expect(200);
      const filtered = await list({
        search: `  ${email.toUpperCase()}  `,
        role: Role.USER,
        status,
        limit: 1,
      }).expect(200);
      expect(filtered.body).toMatchObject({
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
      });
      expect(filtered.body.items[0]).toMatchObject({
        id: targetId,
        status,
        email,
      });
      expect(Object.keys(filtered.body.items[0]).sort()).toEqual([
        'createdAt',
        'email',
        'id',
        'name',
        'role',
        'status',
      ]);
      const past = await list({
        search: email,
        role: Role.USER,
        status,
        page: 2,
        limit: 1,
      }).expect(200);
      expect(past.body.items).toEqual([]);
      expect(past.body.total).toBe(1);
      const opposite = await list({
        search: email,
        status:
          status === AccountStatus.ACTIVE
            ? AccountStatus.SUSPENDED
            : AccountStatus.ACTIVE,
      }).expect(200);
      expect(opposite.body.total).toBe(0);
    }
  });
  it('preserves explicit partial failure: audit write failure reports 500 after the committed status change', async () => {
    const auditRecords = db.model('AuditLog');
    jest
      .spyOn(auditRecords, 'create')
      .mockRejectedValueOnce(new Error('synthetic-private-audit-diagnostic'));
    const result = await patch('suspend').expect(500);
    expect(result.body.message).toBe(
      'Account status changed, but audit logging failed',
    );
    expect(JSON.stringify(result.body)).not.toContain('synthetic-private');
    expect((await users.findById(targetId))!.status).toBe(
      AccountStatus.SUSPENDED,
    );
    expect(await db.collection('auditLogs').countDocuments({ targetId })).toBe(
      0,
    );
    expect(
      await db
        .collection('notifications')
        .countDocuments({ userId: new Types.ObjectId(targetId) }),
    ).toBe(0);
    await patch('suspend').expect(200);
    await patch('suspend').expect(200);
    expect(await db.collection('auditLogs').countDocuments({ targetId })).toBe(
      1,
    );
    expect(
      await db
        .collection('notifications')
        .countDocuments({ userId: new Types.ObjectId(targetId) }),
    ).toBe(1);
    await patch('reactivate').expect(200);
    expect(await db.collection('auditLogs').countDocuments({ targetId })).toBe(
      2,
    );
  });
  it('preserves the shared swallowed-notification failure without claiming guaranteed delivery', async () => {
    jest
      .spyOn(db.model('Notification'), 'create')
      .mockRejectedValueOnce(new Error('synthetic-notification-diagnostic'));
    await patch('suspend').expect(200);
    expect((await users.findById(targetId))!.status).toBe(
      AccountStatus.SUSPENDED,
    );
    expect(await db.collection('auditLogs').countDocuments({ targetId })).toBe(
      1,
    );
    expect(
      await db
        .collection('notifications')
        .countDocuments({ userId: new Types.ObjectId(targetId) }),
    ).toBe(0);
  });
  it('cannot suspend the administrator themselves', async () => {
    const before = await users.collection.findOne({
      _id: new Types.ObjectId(adminId),
    });
    await patch('suspend', adminId).expect(409);
    expect(
      await users.collection.findOne({ _id: new Types.ObjectId(adminId) }),
    ).toEqual(before);
  });
  it('reconciles a committed audit after a lost acknowledgement without duplicating it', async () => {
    const audit = app.get(AuditService);
    const original = audit.log.bind(audit);
    jest.spyOn(audit, 'log').mockImplementationOnce(async (input) => {
      await original(input);
      throw new Error('synthetic-lost-ack');
    });
    await patch('suspend').expect(500);
    expect(await db.collection('auditLogs').countDocuments({ targetId })).toBe(
      1,
    );
    expect(
      await db
        .collection('notifications')
        .countDocuments({ userId: new Types.ObjectId(targetId) }),
    ).toBe(0);
    await patch('suspend').expect(200);
    await patch('suspend').expect(200);
    expect(await db.collection('auditLogs').countDocuments({ targetId })).toBe(
      1,
    );
    expect(
      await db
        .collection('notifications')
        .countDocuments({ userId: new Types.ObjectId(targetId) }),
    ).toBe(1);
  });
  it('retains the explicit response to an unexpected rejected notification promise', async () => {
    jest
      .spyOn(app.get(NotificationsService), 'notify')
      .mockRejectedValueOnce(new Error('synthetic-notification-rejection'));
    const result = await patch('suspend').expect(500);
    expect(result.body.message).toBe(
      'Account status changed, but notification delivery failed',
    );
    expect((await users.findById(targetId))!.status).toBe(
      AccountStatus.SUSPENDED,
    );
    expect(await db.collection('auditLogs').countDocuments({ targetId })).toBe(
      1,
    );
  });
  it('documents GET and both PATCH endpoints in production AppModule Swagger', async () => {
    expect(app.get(AuditService)).toBeDefined();
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(res.body.paths['/api/admin/accounts'].get).toBeDefined();
    for (const method of ['suspend', 'reactivate']) {
      const operation =
        res.body.paths[`/api/admin/accounts/{id}/${method}`].patch;
      expect(operation.security).toContainEqual({ cookie: [] });
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining([
          '200',
          '400',
          '401',
          '403',
          '404',
          '409',
          '500',
        ]),
      );
      expect(
        operation.requestBody.content['application/json'].schema
          .additionalProperties,
      ).toBe(false);
    }
  });
});
