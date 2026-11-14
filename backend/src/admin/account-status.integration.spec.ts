import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';
import { AccountStatus, NotificationType, Role } from '../common';
import configuration from '../config/configuration';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { setupApp, setupSwagger } from '../setup-app';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import {
  AccountStatusOperation,
  AccountStatusOperationSchema,
} from './schemas/account-status-operation.schema';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

/** Explicit test fixture only. No competing production AdminModule or AppModule edit. */
describe('ACC-16 fixture integration: real MongoDB, auth, audit and notifications', () => {
  let app: INestApplication,
    mongo: MongoMemoryServer,
    db: Connection,
    users: Model<User>;
  let targetId: string, adminId: string, passwordHash: string;
  const secret = 'acc16-fixture-access-0123456789abcdef';
  const password = 'Acc16FixturePass123';
  const keys = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECURE'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const cookies = {} as Record<Role, string>;
  const actor = {
    get userId() {
      return adminId;
    },
    role: Role.ADMIN,
  };
  const id = () => new Types.ObjectId().toString();
  const patch = (
    method: 'suspend' | 'reactivate',
    target = targetId,
    cookie = cookies[Role.ADMIN],
  ) =>
    request(app.getHttpServer())
      .patch(`/api/admin/accounts/${target}/${method}`)
      .set('Cookie', cookie);
  const account = async (role = Role.USER, status = AccountStatus.ACTIVE) =>
    users.create({
      name: 'Status Fixture',
      email: `${id()}@example.test`,
      passwordHash,
      role,
      status,
      consentAcceptedAt: new Date('2026-11-01'),
      preferredCurrency: 'USD',
      phone: '+1234567890',
    });
  beforeAll(async () => {
    Object.assign(process.env, {
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: 'acc16-fixture-refresh-0123456789abcdef',
      COOKIE_SECURE: 'false',
    });
    passwordHash = await hash(password, 4);
    mongo = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          {
            name: AccountStatusOperation.name,
            schema: AccountStatusOperationSchema,
          },
        ]),
        AuthModule,
        AuditModule,
        NotificationsModule,
      ],
      providers: [AccountStatusService],
      controllers: [AccountStatusController],
    }).compile();
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
  });
  beforeEach(async () => {
    const target = await account();
    targetId = target._id.toString();
    await db.collection('auditLogs').deleteMany({});
    await db.collection('notifications').deleteMany({});
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it('suspends and reactivates, records safe audits and both correct notification types', async () => {
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
      action: 'USER_SUSPENDED',
      targetType: 'User',
      targetId,
      details: { before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED' } },
    });
    expect(audits[1]).toMatchObject({
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
    expect(JSON.stringify(audits)).not.toMatch(
      /passwordHash|cookie|token|Acc16FixturePass/,
    );
  });
  it('uses existing login and guard behavior before suspension, during suspension and after reactivation', async () => {
    const user = (await users.findById(targetId).lean())!;
    const login = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password });
    const active = await login().expect(200);
    const oldCookie = (active.headers['set-cookie'] as unknown as string[])
      .find((value) => value.startsWith('access_token='))!
      .split(';')[0];
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', oldCookie)
      .expect(200);
    await patch('suspend').expect(200);
    expect((await login().expect(403)).body.message).toBe('Account suspended');
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', oldCookie)
      .expect(401);
    await patch('reactivate').expect(200);
    await login().expect(200);
    // Still-unexpired access token becomes usable again; no new revocation mechanism.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', oldCookie)
      .expect(200);
  });
  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'denies authenticated %s on both routes',
    async (role) => {
      for (const method of ['suspend', 'reactivate'] as const)
        await patch(method, targetId, cookies[role]).expect(403);
      expect((await users.findById(targetId))!.status).toBe(
        AccountStatus.ACTIVE,
      );
      expect(await db.collection('auditLogs').countDocuments()).toBe(0);
    },
  );
  it('requires authentication on both routes', async () => {
    for (const method of ['suspend', 'reactivate'])
      await request(app.getHttpServer())
        .patch(`/api/admin/accounts/${targetId}/${method}`)
        .expect(401);
  });
  it.each(['suspend', 'reactivate'] as const)(
    'rejects malformed/missing target and body overrides for %s',
    async (method) => {
      await patch(method, 'not-an-id').expect(400);
      await patch(method, id()).expect(404);
      for (const body of [
        { status: 'ACTIVE' },
        { role: 'ADMIN' },
        { id: adminId },
        { reason: 'not supported' },
      ])
        await patch(method).send(body).expect(400);
      expect((await users.findById(targetId))!.status).toBe(
        AccountStatus.ACTIVE,
      );
      expect(await db.collection('auditLogs').countDocuments()).toBe(0);
    },
  );
  it.each([Role.ADMIN, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'rejects %s targets without mutation or side effects',
    async (role) => {
      const user = await account(role);
      const before = await users.collection.findOne({ _id: user._id });
      for (const method of ['suspend', 'reactivate'] as const)
        await patch(method, user._id.toString()).expect(409);
      expect(await users.collection.findOne({ _id: user._id })).toEqual(before);
      expect(await db.collection('auditLogs').countDocuments()).toBe(0);
      expect(await db.collection('notifications').countDocuments()).toBe(0);
    },
  );
  it('accepts idempotent repeats but rejects DEACTIVATED targets', async () => {
    await patch('reactivate').expect(200);
    await patch('suspend').expect(200);
    const suspended = await users.collection.findOne({
      _id: new Types.ObjectId(targetId),
    });
    await patch('suspend').expect(200);
    expect(
      await users.collection.findOne({ _id: new Types.ObjectId(targetId) }),
    ).toEqual(suspended);
    await patch('reactivate').expect(200);
    const active = await users.collection.findOne({
      _id: new Types.ObjectId(targetId),
    });
    await patch('reactivate').expect(200);
    expect(
      await users.collection.findOne({ _id: new Types.ObjectId(targetId) }),
    ).toEqual(active);
    const deactivated = await account(Role.USER, AccountStatus.DEACTIVATED);
    for (const method of ['suspend', 'reactivate'] as const)
      await patch(method, deactivated._id.toString()).expect(409);
    expect((await users.findById(deactivated._id))!.status).toBe(
      AccountStatus.DEACTIVATED,
    );
    expect(await db.collection('auditLogs').countDocuments()).toBe(2);
    expect(await db.collection('notifications').countDocuments()).toBe(2);
  });
  it('allows exactly one winner per direction under concurrent requests from separate service instances', async () => {
    const first = app.get(AccountStatusService);
    const other = new AccountStatusService(
      users,
      app.get(AuditService),
      app.get(NotificationsService),
      db.model<AccountStatusOperation>(AccountStatusOperation.name),
    );
    for (const method of ['suspend', 'reactivate'] as const) {
      const results = await Promise.allSettled([
        first[method](actor, targetId),
        other[method](actor, targetId),
        first[method](actor, targetId),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(3);
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
  it('preserves account fields, bookings, payment records and visible/hidden content through both transitions', async () => {
    const names = [
      'flightBookings',
      'hotelBookings',
      'payments',
      'posts',
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
        fixture: 'preserve',
      });
      snapshots.set(
        name,
        await db.collection(name).find({}).sort({ _id: 1 }).toArray(),
      );
    }
    const before = (await users.collection.findOne({
      _id: new Types.ObjectId(targetId),
    }))!;
    for (const method of ['suspend', 'reactivate'] as const) {
      await patch(method).expect(200);
      const after = (await users.collection.findOne({
        _id: new Types.ObjectId(targetId),
      }))!;
      delete after.status;
      delete after.updatedAt;
      const expected = { ...before };
      delete expected.status;
      delete expected.updatedAt;
      expect(after).toEqual(expected);
      for (const name of names)
        expect(
          await db.collection(name).find({}).sort({ _id: 1 }).toArray(),
        ).toEqual(snapshots.get(name));
    }
  });
  it('does not mutate state or create side effects on a database update failure', async () => {
    jest.spyOn(users, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('synthetic-driver-diagnostic');
    });
    const res = await patch('suspend').expect(500);
    expect(res.body.message).toBe('Account status could not be changed');
    expect((await users.findById(targetId))!.status).toBe(AccountStatus.ACTIVE);
    expect(await db.collection('auditLogs').countDocuments()).toBe(0);
    expect(await db.collection('notifications').countDocuments()).toBe(0);
  });
  it('recovers failed audit on retry with the original actor, before notifying, without rollback', async () => {
    jest
      .spyOn(app.get(AuditService), 'log')
      .mockRejectedValueOnce(new Error('synthetic-audit-diagnostic'));
    const res = await patch('suspend').expect(500);
    expect(res.body.message).toBe(
      'Account status changed, but audit logging failed',
    );
    expect(JSON.stringify(res.body)).not.toContain('synthetic-audit');
    expect((await users.findById(targetId))!.status).toBe(
      AccountStatus.SUSPENDED,
    );
    expect(await db.collection('auditLogs').countDocuments()).toBe(0);
    expect(await db.collection('notifications').countDocuments()).toBe(0);
    const differentAdmin = await account(Role.ADMIN);
    const retryCookie = `access_token=${new JwtService().sign({ sub: differentAdmin._id.toString(), role: Role.ADMIN }, { secret, expiresIn: '15m' })}`;
    await patch('suspend', targetId, retryCookie).expect(200);
    const recovered = await db.collection('auditLogs').findOne({ targetId });
    expect(recovered).toMatchObject({
      actorId: adminId,
      action: 'USER_SUSPENDED',
    });
    await patch('suspend').expect(200);
    expect(await db.collection('auditLogs').countDocuments()).toBe(1);
    expect(await db.collection('notifications').countDocuments()).toBe(1);
    await patch('reactivate').expect(200);
  });
  it('rejects an administrator suspending themselves', async () => {
    const before = await users.collection.findOne({
      _id: new Types.ObjectId(adminId),
    });
    await patch('suspend', adminId).expect(409);
    expect(
      await users.collection.findOne({ _id: new Types.ObjectId(adminId) }),
    ).toEqual(before);
    expect(await db.collection('auditLogs').countDocuments()).toBe(0);
  });
  it('demonstrates the shared notify() limitation: swallowed persistence failure is not proof of delivery', async () => {
    const notifications = db.model('Notification');
    jest
      .spyOn(notifications, 'create')
      .mockRejectedValueOnce(new Error('synthetic-notification-diagnostic'));
    await patch('suspend').expect(200);
    expect((await users.findById(targetId))!.status).toBe(
      AccountStatus.SUSPENDED,
    );
    expect(await db.collection('auditLogs').countDocuments()).toBe(1);
    expect(await db.collection('notifications').countDocuments()).toBe(0);
  });
  it('documents both fixture endpoints, admin authorization, no body fields and required responses', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    for (const path of [
      '/api/admin/accounts/{id}/suspend',
      '/api/admin/accounts/{id}/reactivate',
    ]) {
      const op = res.body.paths[path].patch;
      expect(op.security).toContainEqual({ cookie: [] });
      expect(Object.keys(op.responses)).toEqual(
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
        op.requestBody.content['application/json'].schema.additionalProperties,
      ).toBe(false);
    }
  });
});
