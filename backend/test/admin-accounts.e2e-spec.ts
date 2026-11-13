import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AccountStatus, Role } from '../src/common';
import { setupApp, setupSwagger } from '../src/setup-app';
import { User } from '../src/users/schemas/user.schema';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

describe('ACC-14 real AppModule account list, database filtering and authorization', () => {
  let app: INestApplication, mongo: MongoMemoryServer, root: string;
  let users: Model<User>;
  const cookies = {} as Record<Role, string>;
  const secret = 'acc14-fixture-access-0123456789abcdef';
  const envKeys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));
  const registered = new Date('2026-11-01T09:00:00.000Z');
  const fields = ['id', 'name', 'email', 'role', 'status', 'createdAt'].sort();
  let fixture: Array<{
    _id: Types.ObjectId;
    name: string;
    email: string;
    role: Role;
    status: AccountStatus;
    createdAt: Date;
  }>;
  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'acc14-e2e-'));
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: 'acc14-fixture-refresh-0123456789abcdef',
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
    users = app.get<Connection>(getConnectionToken()).model<User>(User.name);
    const roles = Object.values(Role);
    fixture = Array.from({ length: 27 }, (_, i) => ({
      _id: new Types.ObjectId(),
      name: `Account ${i.toString().padStart(2, '0')}`,
      email: `account${i.toString().padStart(2, '0')}@example.test`,
      role: roles[i % roles.length],
      status:
        i < 4 ? AccountStatus.ACTIVE : Object.values(AccountStatus)[i % 3],
      createdAt: registered,
    }));
    fixture[4].name = 'Needle Name';
    fixture[4].email = 'unrelated@example.test';
    fixture[5].name = 'Different Name';
    fixture[5].email = 'needle.email@example.test';
    fixture[6].name = 'Literal .*+[x](a)?^$|\\ Marker';
    fixture[7].email = 'literal+tag@example.test';
    await users.insertMany(
      fixture.map((row) => ({
        ...row,
        passwordHash: 'synthetic-private-password-hash',
        failedAttempts: 3,
        lockedUntil: new Date('2026-12-01'),
        consentAcceptedAt: registered,
        preferredCurrency: 'USD',
        phone: '+1234567890',
        updatedAt: registered,
      })),
    );
    for (const role of roles) {
      const account = fixture.find(
        (row) => row.role === role && row.status === AccountStatus.ACTIVE,
      )!;
      cookies[role] =
        `access_token=${new JwtService().sign({ sub: account._id.toString(), role }, { secret, expiresIn: '15m' })}`;
    }
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
  const list = (query: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .get('/api/admin/accounts')
      .set('Cookie', cookies[Role.ADMIN])
      .query(query);
  const ids = (body: { items: Array<{ id: string }> }) =>
    body.items.map((item) => item.id);
  const expected = (rows = fixture) =>
    [...rows]
      .sort((a, b) => a._id.toString().localeCompare(b._id.toString()))
      .map((row) => row._id.toString());
  it('returns exactly ten accounts by default with the standard envelope and all six permitted fields', async () => {
    const res = await list().expect(200);
    expect(res.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 27,
      totalPages: 3,
    });
    expect(res.body.items).toHaveLength(10);
    expect(ids(res.body)).toEqual(expected().slice(0, 10));
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(fields);
      expect(item.createdAt).toBe(registered.toISOString());
    }
  });
  it('pages deterministically without duplicates when registration timestamps are identical', async () => {
    const pages = await Promise.all([
      list({ page: 1 }),
      list({ page: 2 }),
      list({ page: 3 }),
    ]);
    const all = pages.flatMap((res) => ids(res.body));
    expect(all).toEqual(expected());
    expect(new Set(all).size).toBe(27);
    expect(ids((await list({ page: 2 })).body)).toEqual(ids(pages[1].body));
  });
  it('supports custom/max limits and out-of-range pages', async () => {
    const custom = await list({ page: 2, limit: 3 }).expect(200);
    expect(ids(custom.body)).toEqual(expected().slice(3, 6));
    expect(custom.body.totalPages).toBe(9);
    const maximum = await list({ limit: 50 }).expect(200);
    expect(maximum.body.items).toHaveLength(27);
    expect(maximum.body.totalPages).toBe(1);
    const past = await list({ page: 999999 }).expect(200);
    expect(past.body).toEqual({
      items: [],
      page: 999999,
      limit: 10,
      total: 27,
      totalPages: 3,
    });
  });
  it('returns 401 for missing or invalid authentication', async () => {
    await request(app.getHttpServer()).get('/api/admin/accounts').expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/accounts')
      .set('Cookie', 'access_token=invalid')
      .expect(401);
  });
  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'returns 403 for authenticated %s',
    async (role) => {
      await request(app.getHttpServer())
        .get('/api/admin/accounts')
        .set('Cookie', cookies[role])
        .expect(403);
    },
  );
  it('matches names OR emails with trimmed case-insensitive literal search', async () => {
    const res = await list({ search: '  nEeDlE  ' }).expect(200);
    expect(ids(res.body)).toEqual(expected([fixture[4], fixture[5]]));
    expect(res.body.total).toBe(2);
    expect(
      ids((await list({ search: 'Needle Name' }).expect(200)).body),
    ).toEqual([fixture[4]._id.toString()]);
    expect(
      ids((await list({ search: 'needle.email@' }).expect(200)).body),
    ).toEqual([fixture[5]._id.toString()]);
  });
  it.each(['.*+[x](a)?^$|\\', '+tag@', '[', '\\'])(
    'treats search %s as literal text',
    async (search) => {
      const res = await list({ search, limit: 50 }).expect(200);
      expect(ids(res.body)).toEqual(
        expected(
          fixture.filter(
            (row) =>
              row.name.toLowerCase().includes(search.toLowerCase()) ||
              row.email.toLowerCase().includes(search.toLowerCase()),
          ),
        ),
      );
    },
  );
  it.each(Object.values(Role))(
    'filters role %s in MongoDB before pagination',
    async (role) => {
      const res = await list({ role, limit: 3 }).expect(200);
      const rows = fixture.filter((row) => row.role === role);
      expect(res.body.total).toBe(rows.length);
      expect(ids(res.body)).toEqual(expected(rows).slice(0, 3));
    },
  );
  it.each(Object.values(AccountStatus))(
    'filters account status %s including inactive accounts',
    async (status) => {
      const res = await list({ status, limit: 50 }).expect(200);
      expect(ids(res.body)).toEqual(
        expected(fixture.filter((row) => row.status === status)),
      );
    },
  );
  it('combines search, role and status before computing totals and pages', async () => {
    const query = {
      search: 'account',
      role: Role.USER,
      status: AccountStatus.ACTIVE,
      page: 2,
      limit: 1,
    };
    const rows = fixture.filter(
      (row) =>
        row.role === query.role &&
        row.status === query.status &&
        (row.name.toLowerCase().includes('account') ||
          row.email.includes('account')),
    );
    const res = await list(query).expect(200);
    expect(res.body.total).toBe(rows.length);
    expect(ids(res.body)).toEqual(expected(rows).slice(1, 2));
    expect(res.body.totalPages).toBe(rows.length);
    const empty = await list({
      search: 'needle',
      role: Role.ADMIN,
      status: AccountStatus.DEACTIVATED,
    }).expect(200);
    const matching = fixture.filter(
      (row) =>
        row.role === Role.ADMIN &&
        row.status === AccountStatus.DEACTIVATED &&
        (row.name.toLowerCase().includes('needle') ||
          row.email.includes('needle')),
    );
    expect(empty.body.total).toBe(matching.length);
  });
  it('handles empty results, blank search and the 100-character search boundary', async () => {
    expect(
      (await list({ search: 'no-such-fixture' }).expect(200)).body,
    ).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
    expect((await list({ search: '   ' }).expect(200)).body.total).toBe(27);
    await list({ search: 'x'.repeat(100) }).expect(200);
  });
  it.each([
    { page: 0 },
    { page: -1 },
    { page: 'bad' },
    { page: 1.5 },
    { limit: 0 },
    { limit: 51 },
    { limit: 'bad' },
    { limit: 2.5 },
    { role: 'ROOT' },
    { status: 'UNKNOWN' },
    { role: '' },
    { status: '' },
    { search: 'x'.repeat(101) },
    { search: ['one', 'two'] },
    { role: ['ADMIN', 'USER'] },
    { 'status[$ne]': 'ACTIVE' },
    { $where: 'fixture' },
    { sort: 'email' },
  ])('rejects invalid or unsupported query %#', async (query) => {
    const res = await list(query).expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: expect.any(Array),
      path: '/api/admin/accounts',
      timestamp: expect.any(String),
    });
  });
  it('never returns secrets or internal fields and leaves all account documents unchanged', async () => {
    const before = await users.collection.find({}).sort({ _id: 1 }).toArray();
    for (const query of [
      { limit: 50 },
      { search: 'needle' },
      { role: Role.USER, status: AccountStatus.SUSPENDED },
    ]) {
      const res = await list(query).expect(200);
      for (const item of res.body.items)
        expect(Object.keys(item).sort()).toEqual(fields);
      expect(JSON.stringify(res.body)).not.toMatch(
        /passwordHash|synthetic-private|failedAttempts|lockedUntil|consentAcceptedAt|preferredCurrency|phone|updatedAt|__v|_id|refreshToken/,
      );
    }
    expect(await users.collection.find({}).sort({ _id: 1 }).toArray()).toEqual(
      before,
    );
  });
  it('sanitizes database failures without leaking raw driver messages', async () => {
    jest.spyOn(users, 'countDocuments').mockImplementationOnce(() => {
      throw new Error('synthetic-private-database-diagnostic');
    });
    const res = await list().expect(500);
    expect(res.body.message).toBe('Accounts could not be retrieved');
    expect(JSON.stringify(res.body)).not.toContain('synthetic-private');
  });
  it('documents exact endpoint, cookie auth, all query parameters and DTO/error schemas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const op = res.body.paths['/api/admin/accounts'].get;
    expect(op.security).toContainEqual({ cookie: [] });
    expect(op.parameters.map((p: { name: string }) => p.name).sort()).toEqual([
      'limit',
      'page',
      'role',
      'search',
      'status',
    ]);
    expect(Object.keys(op.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '500']),
    );
    expect(
      op.parameters.find((p: { name: string }) => p.name === 'limit').schema,
    ).toMatchObject({ default: 10, maximum: 50 });
    expect(
      op.parameters.find((p: { name: string }) => p.name === 'search').schema
        .maxLength,
    ).toBe(100);
    expect(
      Object.keys(
        res.body.components.schemas.AccountResponseDto.properties,
      ).sort(),
    ).toEqual(fields);
    expect(
      res.body.components.schemas.AccountResponseDto.properties.createdAt
        .format,
    ).toBe('date-time');
  });
});
