import { Controller, Get, INestApplication, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { compare, hashSync } from 'bcryptjs';
import { Connection, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AuditService } from '../src/audit/audit.service';
import { TemporaryPasswordService } from '../src/admin/temporary-password.service';
import { AccountStatus, Role } from '../src/common';
import { setupApp, buildSwaggerDocument } from '../src/setup-app';
import { UsersService } from '../src/users/users.service';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

@Controller('acc07-new-protected')
class NewProtectedController {
  @Get()
  probe() {
    return { ok: true };
  }
}

describe('ACC-07a actual AppModule: administrator reset and restricted authentication', () => {
  let app: INestApplication,
    mongo: MongoMemoryServer,
    root: string,
    db: Connection;
  const password = 'OriginalPass1';
  const replacement = 'PermanentPass2';
  const accessSecret = 'acc07-access-fixture-0123456789abcdef';
  const refreshSecret = 'acc07-refresh-fixture-0123456789abcdef';
  let sequence = 0;
  const cookies = {} as Record<Role, string[]>;
  let adminId: string;
  const keys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const http = () => request(app.getHttpServer());
  const cookieJar = (res: request.Response): string[] =>
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).map(
      (c) => c.split(';')[0],
    );
  const login = (email: string, value = password) =>
    http().post('/api/auth/login').send({ email, password: value });
  const reset = (id: string, actor = cookies[Role.ADMIN]) =>
    http()
      .post(`/api/admin/users/${id}/reset-password`)
      .set('Cookie', actor)
      .send({});
  const change = (
    jar: string[],
    currentPassword: string,
    newPassword = replacement,
  ) =>
    http()
      .patch('/api/auth/change-password')
      .set('Cookie', jar)
      .send({ currentPassword, newPassword });
  const record = (id: string) =>
    db.collection('users').findOne({ _id: new Types.ObjectId(id) });
  const insert = async (extra: Record<string, unknown> = {}) => {
    const _id = new Types.ObjectId();
    const email = `acc07-${++sequence}@example.test`;
    await db
      .collection('users')
      .insertOne({
        _id,
        name: 'Synthetic account',
        email,
        passwordHash: hashSync(password, 4),
        role: Role.USER,
        status: AccountStatus.ACTIVE,
        preferredCurrency: 'USD',
        consentAcceptedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...extra,
      });
    return { id: _id.toString(), email };
  };
  const temporarySession = async () => {
    const account = await insert();
    const issued = await reset(account.id).expect(200);
    const secret = issued.body.temporaryPassword as string;
    const authenticated = await login(account.email, secret).expect(200);
    return { ...account, secret, jar: cookieJar(authenticated) };
  };
  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'acc07-app-'));
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: accessSecret,
      JWT_REFRESH_SECRET: refreshSecret,
      COOKIE_SECURE: 'false',
    });
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const configSpy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        configure({ ...options, ignoreEnvFile: true }),
      );
    try {
      const { AppModule } = await import('../src/app.module');
      const module = await Test.createTestingModule({
        imports: [AppModule],
        controllers: [NewProtectedController],
      })
        .overrideProvider(UPLOAD_OPTIONS)
        .useValue({
          root,
          leaseMs: 60000,
          recoveryIntervalMs: 3600000,
          recoveryBatchSize: 50,
        })
        .compile();
      app = module.createNestApplication();
      app.useLogger(false);
      setupApp(app);
      await app.listen(0, '127.0.0.1');
    } finally {
      configSpy.mockRestore();
    }
    db = app.get<Connection>(getConnectionToken());
    for (const role of Object.values(Role)) {
      const account = await insert({
        role,
        ...(role === Role.AIRLINE_MODERATOR
          ? { airlineId: new Types.ObjectId() }
          : {}),
        ...(role === Role.HOTEL_MODERATOR
          ? { hotelId: new Types.ObjectId() }
          : {}),
      });
      if (role === Role.ADMIN) adminId = account.id;
      cookies[role] = cookieJar(await login(account.email).expect(200));
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

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'forbids %s callers without changing the target',
    async (role) => {
      const target = await insert();
      const before = await record(target.id);
      await reset(target.id, cookies[role]).expect(403);
      expect(await record(target.id)).toEqual(before);
    },
  );
  it('requires authentication', async () => {
    await reset((await insert()).id, []).expect(401);
  });
  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'resets an ACTIVE %s; stores salted hash, 24h expiry, version and safe audit only',
    async (role) => {
      const provider = new Types.ObjectId();
      const target = await insert({
        role,
        ...(role === Role.AIRLINE_MODERATOR ? { airlineId: provider } : {}),
        ...(role === Role.HOTEL_MODERATOR ? { hotelId: provider } : {}),
      });
      const before = (await record(target.id))!;
      const start = Date.now();
      const response = await reset(target.id).expect(200);
      const finish = Date.now();
      expect(response.headers['cache-control']).toBe('no-store');
      expect(Object.keys(response.body).sort()).toEqual([
        'expiresAt',
        'id',
        'temporaryPassword',
      ]);
      const after = (await record(target.id))!;
      expect(after.mustChangePassword).toBe(true);
      expect(after.temporaryPasswordConsumed).toBe(false);
      expect(after.tokenVersion).toBe(1);
      const expires = Date.parse(response.body.expiresAt);
      expect(expires >= start + 86400000 && expires <= finish + 86400000).toBe(
        true,
      );
      expect(after.temporaryPasswordExpiresAt.getTime()).toBe(expires);
      expect(
        await compare(response.body.temporaryPassword, after.passwordHash),
      ).toBe(true);
      expect(after.passwordHash.startsWith('$2b$10$')).toBe(true);
      expect(
        JSON.stringify(after).includes(response.body.temporaryPassword),
      ).toBe(false);
      for (const key of [
        'role',
        'status',
        'airlineId',
        'hotelId',
        'email',
        'name',
        'consentAcceptedAt',
      ])
        expect(after[key]).toEqual(before[key]);
      const audit = await db
        .collection('auditLogs')
        .findOne({ targetId: target.id, action: 'ADMIN_PASSWORD_RESET' });
      expect(audit).toMatchObject({
        actorId: adminId,
        targetId: target.id,
        targetType: 'USER',
        createdAt: expect.any(Date),
      });
      expect(Object.keys(audit!).sort()).toEqual([
        '__v',
        '_id',
        'action',
        'actorId',
        'createdAt',
        'targetId',
        'targetType',
        'updatedAt',
      ]);
      expect(
        JSON.stringify(audit).includes(response.body.temporaryPassword),
      ).toBe(false);
      expect(JSON.stringify(audit).includes(after.passwordHash)).toBe(false);
      await login(target.email).expect(401);
      const session = await login(
        target.email,
        response.body.temporaryPassword,
      ).expect(200);
      expect(session.body.mustChangePassword).toBe(true);
      expect(
        JSON.stringify(session.body).includes(response.body.temporaryPassword),
      ).toBe(false);
      expect(session.body.airlineId).toEqual(before.airlineId?.toString());
      expect(session.body.hotelId).toEqual(before.hotelId?.toString());
    },
  );
  it.each([
    { role: Role.ADMIN },
    { status: AccountStatus.SUSPENDED },
    { status: AccountStatus.DEACTIVATED },
  ])('rejects unsupported target %j unchanged', async (extra) => {
    const target = await insert(extra);
    const before = await record(target.id);
    await reset(target.id).expect(409);
    expect(await record(target.id)).toEqual(before);
  });
  it('rejects malformed/missing target IDs and unknown body fields', async () => {
    await reset('invalid').expect(400);
    await reset(new Types.ObjectId().toString()).expect(404);
    await http()
      .post('/api/admin/users/reset-password')
      .set('Cookie', cookies[Role.ADMIN])
      .send({})
      .expect(404);
    const target = await insert();
    for (const body of [
      { password: 'DoNotEcho1' },
      { role: Role.ADMIN },
      { status: AccountStatus.ACTIVE },
      { id: adminId },
    ]) {
      const response = await http()
        .post(`/api/admin/users/${target.id}/reset-password`)
        .set('Cookie', cookies[Role.ADMIN])
        .send(body)
        .expect(400);
      expect(JSON.stringify(response.body).includes('DoNotEcho1')).toBe(false);
    }
    expect((await record(target.id))!.mustChangePassword).toBeUndefined();
  });
  it('rejects expired temporary credentials without consuming them', async () => {
    const target = await insert();
    const issued = await reset(target.id).expect(200);
    await db
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(target.id) },
        { $set: { temporaryPasswordExpiresAt: new Date(Date.now() - 1) } },
      );
    await login(target.email, issued.body.temporaryPassword).expect(401);
    expect((await record(target.id))!.temporaryPasswordConsumed).toBe(false);
  });
  it('does not consume on failed login, permits exactly one successful temporary login', async () => {
    const target = await insert();
    const issued = await reset(target.id).expect(200);
    await login(target.email, 'WrongPassword1').expect(401);
    expect((await record(target.id))!.temporaryPasswordConsumed).toBe(false);
    await login(target.email, issued.body.temporaryPassword).expect(200);
    expect((await record(target.id))!.temporaryPasswordConsumed).toBe(true);
    await login(target.email, issued.body.temporaryPassword).expect(401);
  });
  it('permits only one winner in concurrent temporary logins', async () => {
    const target = await insert();
    const issued = await reset(target.id).expect(200);
    const results = await Promise.all([
      login(target.email, issued.body.temporaryPassword),
      login(target.email, issued.body.temporaryPassword),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });
  it('keeps the temporary credential consumed if session issuance fails after the atomic claim', async () => {
    const target = await insert();
    const issued = await reset(target.id).expect(200);
    const jwt = app.get(JwtService);
    jest
      .spyOn(jwt, 'signAsync')
      .mockRejectedValueOnce(new Error('synthetic issuance failure'));
    await login(target.email, issued.body.temporaryPassword).expect(500);
    expect((await record(target.id))!.temporaryPasswordConsumed).toBe(true);
    await login(target.email, issued.body.temporaryPassword).expect(401);
    await reset(target.id).expect(200);
  });
  it('immediately invalidates previous access and refresh cookies, including legacy unversioned tokens', async () => {
    const target = await insert();
    const old = cookieJar(await login(target.email).expect(200));
    const jwt = new JwtService();
    const legacyAccess = `access_token=${jwt.sign({ sub: target.id, role: Role.USER }, { secret: accessSecret })}`;
    const legacyRefresh = `refresh_token=${jwt.sign({ sub: target.id }, { secret: refreshSecret, expiresIn: 600, jwtid: 'legacy-acc07' })}`;
    await http().get('/api/auth/me').set('Cookie', legacyAccess).expect(200);
    await reset(target.id).expect(200);
    for (const jar of [old, [legacyAccess]])
      await http().get('/api/auth/me').set('Cookie', jar).expect(401);
    for (const jar of [old, [legacyRefresh]])
      await http().post('/api/auth/refresh').set('Cookie', jar).expect(401);
  });
  it('allows me/change-password/logout only; denies a new protected route and refresh', async () => {
    const target = await temporarySession();
    const me = await http()
      .get('/api/auth/me')
      .set('Cookie', target.jar)
      .expect(200);
    expect(me.body.mustChangePassword).toBe(true);
    for (const field of [
      'passwordHash',
      'temporaryPasswordExpiresAt',
      'temporaryPasswordConsumed',
      'tokenVersion',
    ])
      expect(me.body).not.toHaveProperty(field);
    await http()
      .get('/api/acc07-new-protected')
      .set('Cookie', target.jar)
      .expect(403);
    await http()
      .get('/api/admin/accounts')
      .set('Cookie', target.jar)
      .expect(403);
    await http()
      .post('/api/auth/refresh')
      .set('Cookie', target.jar)
      .expect(401);
    await change(target.jar, 'WrongPass1').expect(400);
    await http().post('/api/auth/logout').set('Cookie', target.jar).expect(200);
    await login(target.email, target.secret).expect(401);
  });
  it('preserves public routes during forced state', async () => {
    const target = await temporarySession();
    await http()
      .post('/api/auth/register')
      .set('Cookie', target.jar)
      .send({
        name: 'New synthetic',
        email: `registration-${++sequence}@example.test`,
        password,
        acceptTerms: true,
      })
      .expect(201);
  });
  it('rejects weak/same/wrong replacements; clears markers and cookies, invalidates forced sessions and restores normal login', async () => {
    const target = await temporarySession();
    const before = (await record(target.id))!;
    for (const weak of [
      'short1',
      'NoDigitsHere',
      '12345678',
      'a1' + 'x'.repeat(71),
    ])
      await change(target.jar, target.secret, weak).expect(400);
    await change(target.jar, target.secret, target.secret).expect(400);
    await change(target.jar, 'WrongPass1').expect(400);
    expect(await record(target.id)).toEqual(before);
    const completed = await change(target.jar, target.secret).expect(204);
    expect(
      (completed.headers['set-cookie'] as unknown as string[]).filter((c) =>
        c.includes('Expires=Thu, 01 Jan 1970'),
      ).length,
    ).toBe(2);
    const after = (await record(target.id))!;
    expect(after.mustChangePassword).toBe(false);
    expect(after.tokenVersion).toBe(2);
    expect(after).not.toHaveProperty('temporaryPasswordExpiresAt');
    expect(after).not.toHaveProperty('temporaryPasswordConsumed');
    expect(await compare(replacement, after.passwordHash)).toBe(true);
    await http().get('/api/auth/me').set('Cookie', target.jar).expect(401);
    await http()
      .post('/api/auth/refresh')
      .set('Cookie', target.jar)
      .expect(401);
    await login(target.email, target.secret).expect(401);
    const normal = await login(target.email, replacement).expect(200);
    expect(normal.body).not.toHaveProperty('mustChangePassword');
    await http()
      .get('/api/acc07-new-protected')
      .set('Cookie', cookieJar(normal))
      .expect(200);
    await http()
      .post('/api/auth/refresh')
      .set('Cookie', cookieJar(normal))
      .expect(200);
  });
  it('preserves ordinary password-change sessions, refresh/logout and suspension status checks', async () => {
    const target = await insert();
    const jar = cookieJar(await login(target.email).expect(200));
    await change(jar, password).expect(204);
    await http().get('/api/auth/me').set('Cookie', jar).expect(200);
    await login(target.email, replacement).expect(200);
    await login(target.email).expect(401);
    await http().post('/api/auth/refresh').set('Cookie', jar).expect(200);
    await db
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(target.id) },
        { $set: { status: AccountStatus.SUSPENDED } },
      );
    await http().get('/api/auth/me').set('Cookie', jar).expect(401);
    await http().post('/api/auth/refresh').set('Cookie', jar).expect(401);
    await login(target.email, replacement).expect(403);
    await db
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(target.id) },
        { $set: { status: AccountStatus.ACTIVE } },
      );
    await http().post('/api/auth/logout').set('Cookie', jar).expect(200);
    await http().post('/api/auth/refresh').set('Cookie', jar).expect(401);
  });
  it('preserves content/bookings and ACC-14 safe account listing', async () => {
    const target = await insert();
    const collections = [
      'flightBookings',
      'hotelBookings',
      'posts',
      'comments',
      'itineraries',
    ];
    const snapshots = [];
    for (const name of collections) {
      const item = {
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(target.id),
        marker: 'synthetic unchanged',
      };
      await db.collection(name).insertOne(item);
      snapshots.push(item);
    }
    const issued = await reset(target.id).expect(200);
    for (let i = 0; i < collections.length; i++)
      expect(
        await db.collection(collections[i]).findOne({ _id: snapshots[i]._id }),
      ).toEqual(snapshots[i]);
    const list = await http()
      .get('/api/admin/accounts')
      .set('Cookie', cookies[Role.ADMIN])
      .query({ search: target.email })
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(Object.keys(list.body.items[0]).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'name',
      'role',
      'status',
    ]);
    expect(
      JSON.stringify(list.body).includes(issued.body.temporaryPassword),
    ).toBe(false);
  });
  it('surfaces audit failure after changing credentials without disclosing or rolling back', async () => {
    const target = await insert();
    const old = cookieJar(await login(target.email).expect(200));
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const passwords = app.get(TemporaryPasswordService);
    const generate = passwords.generate.bind(passwords);
    let temporary = '';
    jest.spyOn(passwords, 'generate').mockImplementationOnce(async () => {
      const result = await generate();
      temporary = result.temporaryPassword;
      return result;
    });
    jest
      .spyOn(app.get(AuditService), 'log')
      .mockRejectedValueOnce(new Error('synthetic-sensitive-diagnostic'));
    const response = await reset(target.id).expect(500);
    expect(response.body.message).toContain('credentials have changed');
    expect(response.body).not.toHaveProperty('temporaryPassword');
    expect(
      JSON.stringify(response.body).includes('synthetic-sensitive-diagnostic'),
    ).toBe(false);
    expect((await record(target.id))!.tokenVersion).toBe(1);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged.includes(temporary)).toBe(false);
    expect(logged.includes((await record(target.id))!.passwordHash)).toBe(
      false,
    );
    expect(logged.includes('synthetic-sensitive-diagnostic')).toBe(false);
    await http().get('/api/auth/me').set('Cookie', old).expect(401);
    await reset(target.id).expect(200);
  });
  it('allows only one concurrent reset based on the same credential version', async () => {
    const target = await insert();
    const service = app.get(TemporaryPasswordService);
    const original = service.generate.bind(service);
    let count = 0,
      release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(service, 'generate').mockImplementation(async () => {
      const generated = await original();
      if (++count === 2) release();
      await wait;
      return generated;
    });
    const responses = await Promise.all([reset(target.id), reset(target.id)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await record(target.id))!.tokenVersion).toBe(1);
    expect(
      await db.collection('auditLogs').countDocuments({ targetId: target.id }),
    ).toBe(1);
    await login(
      target.email,
      responses.find((r) => r.status === 200)!.body.temporaryPassword,
    ).expect(200);
  });
  it('sanitizes credential-write driver diagnostics before responses and error logging', async () => {
    const target = await temporarySession();
    const before = (await record(target.id))!;
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const diagnostic = `synthetic-driver ${before.passwordHash} ${target.secret}`;
    jest.spyOn(db.model('User'), 'updateOne').mockImplementationOnce(() => {
      throw new Error(diagnostic);
    });
    const response = await change(target.jar, target.secret).expect(500);
    const emitted = JSON.stringify([response.body, log.mock.calls]);
    expect(emitted.includes(before.passwordHash)).toBe(false);
    expect(emitted.includes(target.secret)).toBe(false);
    expect(emitted.includes('synthetic-driver')).toBe(false);
    expect(await record(target.id)).toEqual(before);
  });
  it('prevents an ordinary password-change request from overwriting a newer reset', async () => {
    const target = await insert();
    const jar = cookieJar(await login(target.email).expect(200));
    const service = app.get(UsersService);
    const original = service.replacePasswordHash.bind(service);
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest
      .spyOn(service, 'replacePasswordHash')
      .mockImplementationOnce(async (...args) => {
        entered();
        await wait;
        return original(...args);
      });
    const pending = change(jar, password).then((r) => r);
    await reached;
    let issued: request.Response;
    try {
      issued = await reset(target.id).expect(200);
    } finally {
      release();
    }
    expect((await pending).status).toBe(409);
    await login(target.email, replacement).expect(401);
    await login(target.email, issued!.body.temporaryPassword).expect(200);
  });
  it('prevents a delayed forced change from overwriting a newer reset', async () => {
    const target = await temporarySession();
    const service = app.get(UsersService);
    const original = service.completeForcedPasswordChange.bind(service);
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest
      .spyOn(service, 'completeForcedPasswordChange')
      .mockImplementationOnce(async (...args) => {
        entered();
        await wait;
        return original(...args);
      });
    const pending = change(target.jar, target.secret).then((r) => r);
    await reached;
    let issued: request.Response;
    try {
      issued = await reset(target.id).expect(200);
    } finally {
      release();
    }
    expect((await pending).status).toBe(409);
    await login(target.email, replacement).expect(401);
    await login(target.email, issued!.body.temporaryPassword).expect(200);
  });
  it('prevents a delayed pre-completion reset from overwriting forced completion', async () => {
    const target = await temporarySession();
    const service = app.get(TemporaryPasswordService);
    const original = service.generate.bind(service);
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest.spyOn(service, 'generate').mockImplementationOnce(async () => {
      const generated = await original();
      entered();
      await wait;
      return generated;
    });
    const pending = reset(target.id).then((r) => r);
    await reached;
    try {
      await change(target.jar, target.secret).expect(204);
    } finally {
      release();
    }
    expect((await pending).status).toBe(409);
    await login(target.email, replacement).expect(200);
  });
  it('documents the registered reset and forced lifecycle in actual Swagger', () => {
    const swagger = buildSwaggerDocument(app);
    const route = swagger.paths['/api/admin/users/{id}/reset-password'].post!;
    expect(route.security).toEqual([{ cookie: [] }]);
    for (const code of ['200', '400', '401', '403', '404', '409', '500'])
      expect(route.responses).toHaveProperty(code);
    expect(route.description).toContain('24-hour');
    expect(route.responses['200']).toHaveProperty('headers.Cache-Control');
    expect(
      swagger.components!.schemas!.AdminPasswordResetResponseDto,
    ).toHaveProperty('properties.temporaryPassword');
    expect(
      swagger.components!.schemas!.AdminPasswordResetResponseDto,
    ).not.toHaveProperty('properties.passwordHash');
  });
});
