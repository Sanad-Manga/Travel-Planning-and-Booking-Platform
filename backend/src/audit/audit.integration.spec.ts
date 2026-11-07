import { Injectable, Module, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { Role } from '../common';
import configuration from '../config/configuration';
import { setupApp, setupSwagger } from '../setup-app';
import { User } from '../users/schemas/user.schema';
import { AuditModule } from './audit.module';
import { AuditService } from './audit.service';
import { AuditLog } from './schemas/audit-log.schema';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

@Injectable()
class AuditConsumer {
  constructor(readonly audit: AuditService) {}
}
@Module({ imports: [AuditModule], providers: [AuditConsumer] })
class ConsumerModule {}

jest.setTimeout(120000);

describe('AuditModule persistence, exported DI and authenticated HTTP listing', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let records: Model<AuditLog>;
  let users: Model<User>;
  let audit: AuditService;
  let adminCookie: string;
  let actorId: string;
  const accessSecret = 'audit-test-access-0123456789-abcdefghijkl';
  const environment = {
    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: 'audit-test-refresh-0123456789-abcdefghijk',
    COOKIE_SECURE: 'false',
  };
  const previous = new Map(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  const entry = {
    actorId: 'fixture-actor',
    action: 'USER_SUSPENDED',
    targetType: 'User',
    targetId: 'fixture-user',
  };

  async function session(role: Role): Promise<string> {
    const account = await users.create({
      name: 'Audit Fixture',
      email: `${new Types.ObjectId()}@example.test`,
      passwordHash: 'non-login-test-hash',
      role,
      consentAcceptedAt: new Date(),
    });
    const token = new JwtService().sign(
      { sub: account._id.toString(), role },
      { secret: accessSecret, expiresIn: '5m' },
    );
    return `access_token=${token}`;
  }

  beforeAll(async () => {
    Object.assign(process.env, environment);
    mongo = await MongoMemoryServer.create({
      instance: { dbName: 'gen07_audit_disposable' },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        ConsumerModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    setupApp(app);
    setupSwagger(app);
    await app.listen(0, '127.0.0.1');
    const connection = app.get<Connection>(getConnectionToken());
    records = connection.model<AuditLog>(AuditLog.name);
    users = connection.model<User>(User.name);
    await records.init();
    await users.init();
    audit = app.get(AuditConsumer).audit;
    adminCookie = await session(Role.ADMIN);
    actorId = (await users
      .findOne({ role: Role.ADMIN })
      .lean())!._id.toString();
  });
  beforeEach(async () => {
    await records.deleteMany({});
  }); // Only this suite's generated database.
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const list = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/admin/audit-logs${query}`)
      .set('Cookie', adminCookie);

  it('injects one exported service into a consumer module and persists one acknowledged, server-timestamped record', async () => {
    expect(audit).toBe(app.get(AuditService));
    const before = new Date();
    await expect(
      audit.log({
        ...entry,
        actorId,
        targetId: 'CAI',
        details: {
          reason: 'Fixture moderation',
          before: { status: 'ACTIVE' },
          after: { status: 'SUSPENDED' },
        },
      }),
    ).resolves.toBeUndefined();
    expect(await records.countDocuments()).toBe(1);
    const stored = await records.findOne().lean();
    expect(stored).toMatchObject({
      actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: 'CAI',
      details: { reason: 'Fixture moderation' },
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(stored!.createdAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    const response = await list().expect(200);
    expect(response.body.items[0]).toEqual({
      id: stored!._id.toString(),
      actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: 'CAI',
      details: stored!.details,
      createdAt: stored!.createdAt.toISOString(),
    });
  });

  it('stores separate entries for each call, accepts omitted details and ignores supplied timestamps', async () => {
    const forged = {
      ...entry,
      createdAt: new Date('1900-01-01'),
      updatedAt: new Date('1900-01-01'),
    };
    await audit.log(forged);
    await audit.log(entry);
    expect(await records.countDocuments()).toBe(2);
    const response = await list().expect(200);
    expect(response.body.items[0]).not.toHaveProperty('details');
    expect(
      new Date(response.body.items[0].createdAt).getUTCFullYear(),
    ).toBeGreaterThan(1900);
    expect(response.body.items[0]).not.toHaveProperty('_id');
    expect(response.body.items[0]).not.toHaveProperty('__v');
    expect(response.body.items[0]).not.toHaveProperty('updatedAt');
  });

  it.each([0, 1, 10, 23, 61])(
    'paginates %i records with actual totals, defaults and stable equal-timestamp ordering',
    async (count) => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      if (count)
        await records.insertMany(
          Array.from({ length: count }, (_, i) => ({
            ...entry,
            action: `FIXTURE_${i}`,
            createdAt,
            updatedAt: createdAt,
          })),
        );
      const expected = await records
        .find()
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      const first = await list().expect(200);
      expect(first.body).toMatchObject({
        page: 1,
        limit: 10,
        total: count,
        totalPages: Math.ceil(count / 10),
      });
      expect(first.body.items.map((item: { id: string }) => item.id)).toEqual(
        expected.slice(0, 10).map((item) => item._id.toString()),
      );
      const second = await list('?page=2').expect(200);
      expect(second.body.items.map((item: { id: string }) => item.id)).toEqual(
        expected.slice(10, 20).map((item) => item._id.toString()),
      );
      expect((await list('?page=2').expect(200)).body).toEqual(second.body);
      const maximum = await list('?limit=50').expect(200);
      expect(maximum.body.items).toHaveLength(Math.min(count, 50));
      expect(maximum.body.totalPages).toBe(Math.ceil(count / 50));
      const custom = await list('?page=2&limit=3').expect(200);
      expect(custom.body.items.map((item: { id: string }) => item.id)).toEqual(
        expected.slice(3, 6).map((item) => item._id.toString()),
      );
    },
  );

  it('orders by creation timestamp before the descending ID tie-breaker', async () => {
    const lowId = new Types.ObjectId('000000000000000000000001');
    const highId = new Types.ObjectId('ffffffffffffffffffffffff');
    await records.insertMany([
      {
        ...entry,
        _id: highId,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
      {
        ...entry,
        _id: lowId,
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      },
    ]);
    const response = await list().expect(200);
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      lowId.toString(),
      highId.toString(),
    ]);
    expect(await records.collection.indexExists('createdAt_-1__id_-1')).toBe(
      true,
    );
  });

  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=bad',
    'limit=0',
    'limit=51',
    'limit=bad',
    'limit=1.5',
    'action=DELETE',
  ])('rejects invalid or unsupported query %s', async (query) => {
    const response = await list(`?${query}`).expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: expect.any(Array),
      path: '/api/admin/audit-logs',
      timestamp: expect.any(String),
    });
  });

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'returns 403 to an authenticated %s',
    async (role) => {
      const cookie = await session(role);
      const response = await request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .set('Cookie', cookie)
        .expect(403);
      expect(response.body.error).toBe('Forbidden');
    },
  );

  it('returns 401 for missing or invalid authentication', async () => {
    await request(app.getHttpServer()).get('/api/admin/audit-logs').expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .set('Cookie', 'access_token=invalid')
      .expect(401);
  });

  it('rejects sensitive input before persistence and rejects legacy unsafe details on read', async () => {
    await expect(
      audit.log({ ...entry, details: { password: 'synthetic-not-real' } }),
    ).rejects.toThrow('Audit details');
    expect(await records.countDocuments()).toBe(0);
    await records.collection.insertOne({
      ...entry,
      details: { refreshToken: 'synthetic-not-real' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const response = await list().expect(500);
    expect(JSON.stringify(response.body)).not.toMatch(
      /synthetic-not-real|refreshToken/,
    );
  });

  it('propagates write failure and sanitizes read failure without exposing driver messages', async () => {
    jest
      .spyOn(records, 'create')
      .mockRejectedValueOnce(
        new Error('synthetic-private-database-diagnostic'),
      );
    await expect(audit.log(entry)).rejects.toThrow(
      'Audit record could not be persisted',
    );
    expect(await records.countDocuments()).toBe(0);
    jest.spyOn(records, 'countDocuments').mockImplementationOnce(() => {
      throw new Error('mongodb://synthetic-private-database-diagnostic');
    });
    const response = await list().expect(500);
    expect(response.body.message).toBe('Audit records could not be retrieved');
    expect(JSON.stringify(response.body)).not.toMatch(
      /mongodb|synthetic-private/,
    );
  });

  it('exposes no public audit mutation endpoints', async () => {
    const client = request(app.getHttpServer());
    for (const method of ['post', 'put', 'patch', 'delete'] as const)
      await client[method]('/api/admin/audit-logs')
        .set('Cookie', adminCookie)
        .send(entry)
        .expect(404);
    expect(await records.countDocuments()).toBe(0);
  });

  it('documents the exact ADMIN-only GET, shared response schemas, cookie auth and pagination', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const operation = response.body.paths['/api/admin/audit-logs'];
    expect(Object.keys(operation)).toEqual(['get']);
    expect(operation.get.security).toContainEqual({ cookie: [] });
    expect(operation.get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'page',
          schema: expect.objectContaining({ default: 1 }),
        }),
        expect.objectContaining({
          name: 'limit',
          schema: expect.objectContaining({ default: 10, maximum: 50 }),
        }),
      ]),
    );
    expect(Object.keys(operation.get.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '500']),
    );
    expect(
      response.body.components.schemas.AuditLogResponseDto.required,
    ).toEqual(
      expect.arrayContaining([
        'id',
        'actorId',
        'action',
        'targetType',
        'targetId',
        'createdAt',
      ]),
    );
    expect(
      response.body.components.schemas.AuditLogResponseDto.properties.createdAt
        .format,
    ).toBe('date-time');
    expect(response.body.paths).not.toHaveProperty('/api/api/admin/audit-logs');
  });
});
