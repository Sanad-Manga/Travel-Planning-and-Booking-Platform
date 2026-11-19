import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { compare, hashSync } from 'bcryptjs';
import { Connection, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AccountStatus, Role } from '../src/common';
import { buildSwaggerDocument, setupApp } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

/**
 * ACC-13 on the real AppModule and a real (in-memory) MongoDB: admin creates hotel/airline moderators,
 * the temporary-password lifecycle of ACC-07a applies, and the principal carries airlineId/hotelId.
 * Only the in-memory MongoDB is a stand-in for Atlas; nothing is mocked inside the application.
 */
describe('ACC-13 admin creates moderator accounts (actual AppModule)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let root: string;
  let db: Connection;
  let sequence = 0;
  let airlineA: string;
  let airlineB: string;
  let hotelA: string;
  let hotelB: string;
  const password = 'OriginalPass1';
  const temp = 'Temp0rary9Pass';
  const replacement = 'PermanentPass2';
  const keys = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECURE'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const cookies = {} as Record<Role, string[]>;
  const http = () => request(app.getHttpServer());
  const jar = (res: request.Response): string[] =>
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]);
  const login = (email: string, value: string) => http().post('/api/auth/login').send({ email, password: value });
  const email = () => `acc13-${++sequence}@example.test`;
  const create = (body: Record<string, unknown>, cookie = cookies[Role.ADMIN]) =>
    http().post('/api/admin/moderators').set('Cookie', cookie).send(body);
  const hotelBody = (over: Record<string, unknown> = {}) => ({
    name: 'Hala Hotel',
    email: email(),
    role: Role.HOTEL_MODERATOR,
    temporaryPassword: temp,
    hotelId: hotelA,
    ...over,
  });
  const airlineBody = (over: Record<string, unknown> = {}) => ({
    name: 'Omar Airline',
    email: email(),
    role: Role.AIRLINE_MODERATOR,
    temporaryPassword: temp,
    airlineId: airlineA,
    ...over,
  });
  const userByEmail = (value: string) => db.collection('users').findOne({ email: value });
  const countUsers = (value: string) => db.collection('users').countDocuments({ email: value });
  const insertUser = async (role: Role, extra: Record<string, unknown> = {}) => {
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
      ...extra,
    });
    return value;
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'acc13-app-'));
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: 'acc13-access-fixture-0123456789abcdef',
      JWT_REFRESH_SECRET: 'acc13-refresh-fixture-0123456789abcdef',
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
    await db.collection('cities').insertOne({ city_id: 'CAI', name: 'Cairo', country_code: 'EG' });
    for (const role of [Role.ADMIN, Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR]) {
      const value = await insertUser(role, {
        ...(role === Role.AIRLINE_MODERATOR ? { airlineId: new Types.ObjectId() } : {}),
        ...(role === Role.HOTEL_MODERATOR ? { hotelId: new Types.ObjectId() } : {}),
      });
      cookies[role] = jar(await login(value, password).expect(200));
    }
    const admin = cookies[Role.ADMIN];
    const airline = async (name: string, code: string) =>
      (await http().post('/api/airlines').set('Cookie', admin).send({ name, code }).expect(201)).body.id as string;
    airlineA = await airline('Airline A', 'AA');
    airlineB = await airline('Airline B', 'BB');
    const hotel = async (name: string) =>
      (
        await http()
          .post('/api/hotels')
          .set('Cookie', admin)
          .send({ name, address: '12 Corniche El Nil', cityId: 'CAI', description: 'Riverside hotel.', starRating: 4, amenities: ['Wifi'] })
          .expect(201)
      ).body.id as string;
    hotelA = await hotel('Hotel A');
    hotelB = await hotel('Hotel B');
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

  describe('admin only', () => {
    it('answers 401 to a guest and 403 to USER and both moderator roles, creating nothing', async () => {
      const body = hotelBody();
      await http().post('/api/admin/moderators').send(body).expect(401);
      for (const role of [Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR]) {
        await create(body, cookies[role]).expect(403);
      }
      expect(await countUsers(body.email)).toBe(0);
    });
  });

  describe('creation', () => {
    it.each([
      ['hotel', Role.HOTEL_MODERATOR, 'hotelId', 'airlineId'],
      ['airline', Role.AIRLINE_MODERATOR, 'airlineId', 'hotelId'],
    ])(
      'creates a %s moderator: ACTIVE, linked to exactly one provider, hashed temporary password, audited, nothing leaked',
      async (_label, role, linkField, otherField) => {
        const body: Record<string, unknown> = role === Role.HOTEL_MODERATOR ? hotelBody({ name: '  Hala  ', email: ' NEW.Mod@Example.TEST ' }) : airlineBody();
        const targetEmail = String(body.email).trim().toLowerCase();
        const start = Date.now();
        const res = await create(body).expect(201);
        const finish = Date.now();
        expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'email', linkField, 'id', 'name', 'role', 'status'].sort());
        expect(res.body[linkField]).toBe(body[linkField]);
        expect(res.body).not.toHaveProperty(otherField);
        expect(res.body).toMatchObject({ email: targetEmail, role, status: 'ACTIVE' });
        expect(JSON.stringify(res.body)).not.toContain(temp);

        const stored = (await userByEmail(targetEmail))!;
        expect(stored._id.toString()).toBe(res.body.id);
        expect(stored.name).toBe(String(body.name).trim());
        expect(stored[linkField].toString()).toBe(body[linkField]);
        expect(stored).not.toHaveProperty(otherField);
        expect(stored.mustChangePassword).toBe(true);
        expect(stored.temporaryPasswordConsumed).toBe(false);
        const expires = stored.temporaryPasswordExpiresAt.getTime();
        expect(expires >= start + 86400000 && expires <= finish + 86400000).toBe(true);
        expect(stored.passwordHash.startsWith('$2b$10$')).toBe(true);
        expect(await compare(temp, stored.passwordHash)).toBe(true);
        expect(JSON.stringify(stored).includes(temp)).toBe(false);

        const audits = await db.collection('auditLogs').find({ targetId: res.body.id }).toArray();
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          actorId: expect.any(String),
          action: 'MODERATOR_CREATED',
          targetType: 'User',
          details: { role, [linkField]: body[linkField] },
        });
        expect(JSON.stringify(audits[0]).includes(temp)).toBe(false);
        expect(JSON.stringify(audits[0]).toLowerCase()).not.toContain('passwordhash');
      },
    );

    it('allows a deactivated provider and several moderators on the same provider', async () => {
      await db.collection('airlines').updateOne({ _id: new Types.ObjectId(airlineB) }, { $set: { isActive: false } });
      await create(airlineBody({ airlineId: airlineB })).expect(201);
      await create(airlineBody({ airlineId: airlineB })).expect(201);
      await db.collection('airlines').updateOne({ _id: new Types.ObjectId(airlineB) }, { $set: { isActive: true } });
    });
  });

  describe('validation', () => {
    const fields = (res: request.Response) => (res.body.details as Array<{ field: string }>).map((d) => d.field).sort();
    it('rejects both ids, neither id and the wrong kind of id, one details entry per field', async () => {
      let res = await create(hotelBody({ airlineId: airlineA })).expect(400);
      expect(res.body.message).toBe('Validation failed');
      expect(fields(res)).toEqual(['airlineId']);
      res = await create(airlineBody({ hotelId: hotelA })).expect(400);
      expect(fields(res)).toEqual(['hotelId']);
      res = await create(hotelBody({ hotelId: undefined })).expect(400);
      expect(fields(res)).toEqual(['hotelId']);
      res = await create(airlineBody({ airlineId: undefined })).expect(400);
      expect(fields(res)).toEqual(['airlineId']);
      // airline id given to a HOTEL moderator instead of a hotel id: wrong one AND missing one
      res = await create(hotelBody({ hotelId: undefined, airlineId: airlineA })).expect(400);
      expect(fields(res)).toEqual(['airlineId', 'hotelId']);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', path: '/api/admin/moderators' });
    });
    it.each([Role.USER, Role.ADMIN, 'SUPERUSER'])('rejects role %s', async (role) => {
      const res = await create(hotelBody({ role })).expect(400);
      expect(fields(res)).toContain('role');
    });
    it('rejects bad ids, weak passwords, bad names/emails and unknown fields', async () => {
      expect(fields(await create(hotelBody({ hotelId: 'not-an-id' })).expect(400))).toEqual(['hotelId']);
      for (const weak of ['short1', 'NoDigitsHere', '12345678', 'a1' + 'x'.repeat(71)]) {
        expect(fields(await create(hotelBody({ temporaryPassword: weak })).expect(400))).toEqual(['temporaryPassword']);
      }
      expect(fields(await create(hotelBody({ email: 'nope' })).expect(400))).toEqual(['email']);
      expect(fields(await create(hotelBody({ name: '   ' })).expect(400))).toEqual(['name']);
      expect(fields(await create(hotelBody({ status: 'SUSPENDED' })).expect(400))).toEqual(['status']);
      expect(fields(await create({}).expect(400))).toEqual(
        expect.arrayContaining(['name', 'email', 'role', 'temporaryPassword']),
      );
    });
    it('answers 404 with a field detail for an unknown airline or hotel and creates nothing', async () => {
      const missing = new Types.ObjectId().toString();
      const airline = airlineBody({ airlineId: missing });
      let res = await create(airline).expect(404);
      expect(res.body.details).toEqual([{ field: 'airlineId', message: expect.any(String) }]);
      const hotel = hotelBody({ hotelId: missing });
      res = await create(hotel).expect(404);
      expect(res.body.details).toEqual([{ field: 'hotelId', message: expect.any(String) }]);
      // a hotel id is not an airline id
      await create(airlineBody({ airlineId: hotelA })).expect(404);
      expect(await countUsers(String(airline.email))).toBe(0);
      expect(await countUsers(String(hotel.email))).toBe(0);
    });
  });

  describe('duplicate email', () => {
    it('answers 409 for an existing account in any letter case', async () => {
      const existing = await insertUser(Role.USER);
      const res = await create(hotelBody({ email: existing.toUpperCase() })).expect(409);
      expect(res.body.details).toEqual([{ field: 'email', message: 'email already exists' }]);
      expect(await countUsers(existing)).toBe(1);
    });
    it('lets exactly one of several concurrent requests win', async () => {
      const shared = email();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => create(hotelBody({ email: shared })).then((r) => r.status)),
      );
      expect(results.filter((s) => s === 201)).toHaveLength(1);
      expect(results.filter((s) => s === 409)).toHaveLength(5);
      expect(await countUsers(shared)).toBe(1);
    });
  });

  describe('first login and the principal', () => {
    it.each([
      ['hotel', Role.HOTEL_MODERATOR],
      ['airline', Role.AIRLINE_MODERATOR],
    ])(
      '%s moderator: login limited to a forced change, then the principal carries the provider id',
      async (_label, role) => {
        const isHotel = role === Role.HOTEL_MODERATOR;
        const own = isHotel ? hotelA : airlineA;
        const foreign = isHotel ? hotelB : airlineB;
        const body = isHotel ? hotelBody() : airlineBody();
        await create(body).expect(201);
        const route = (id: string) => (isHotel ? `/api/hotels/${id}` : `/api/airlines/${id}`);
        const edit = (cookie: string[], id: string) =>
          http().patch(route(id)).set('Cookie', cookie).send({ name: `Edited ${++sequence}` });

        // First login with the temporary password succeeds and returns the forced-change marker.
        const first = await login(String(body.email), temp).expect(200);
        expect(first.body.mustChangePassword).toBe(true);
        expect(JSON.stringify(first.body)).not.toContain(temp);
        const session = jar(first);
        // The session may only read me, change the password and log out: no moderator work, no refresh.
        expect((await http().get('/api/auth/me').set('Cookie', session).expect(200)).body.role).toBe(role);
        await edit(session, own).expect(403);
        await http().post('/api/auth/refresh').set('Cookie', session).expect(401);
        // The temporary password works once.
        await login(String(body.email), temp).expect(401);
        // Forced replacement ends the session.
        await http()
          .patch('/api/auth/change-password')
          .set('Cookie', session)
          .send({ currentPassword: temp, newPassword: temp })
          .expect(400);
        await http()
          .patch('/api/auth/change-password')
          .set('Cookie', session)
          .send({ currentPassword: temp, newPassword: replacement })
          .expect(204);
        await http().get('/api/auth/me').set('Cookie', session).expect(401);
        const stored = (await userByEmail(String(body.email)))!;
        expect(stored.mustChangePassword).toBe(false);
        expect(stored).not.toHaveProperty('temporaryPasswordExpiresAt');
        // Fresh login: normal session, the principal carries airlineId/hotelId.
        await login(String(body.email), temp).expect(401);
        const fresh = await login(String(body.email), replacement).expect(200);
        expect(fresh.body).not.toHaveProperty('mustChangePassword');
        await edit(jar(fresh), own).expect(200);
        await edit(jar(fresh), foreign).expect(403);
      },
    );

    it('rejects an expired temporary password, and the existing admin reset recovers the account', async () => {
      const body = hotelBody();
      await create(body).expect(201);
      await db
        .collection('users')
        .updateOne({ email: body.email }, { $set: { temporaryPasswordExpiresAt: new Date(Date.now() - 1000) } });
      await login(String(body.email), temp).expect(401);
      const stored = (await userByEmail(String(body.email)))!;
      const reset = await http()
        .post(`/api/admin/users/${stored._id.toString()}/reset-password`)
        .set('Cookie', cookies[Role.ADMIN])
        .send({})
        .expect(200);
      await login(String(body.email), reset.body.temporaryPassword).expect(200);
    });
  });

  describe('swagger', () => {
    it('documents the route with cookie auth, body examples and every error', () => {
      const route = buildSwaggerDocument(app).paths['/api/admin/moderators'].post!;
      expect(route.security).toEqual([{ cookie: [] }]);
      for (const code of ['201', '400', '401', '403', '404', '409', '500']) {
        expect(route.responses).toHaveProperty(code);
      }
      expect(route.requestBody).toBeDefined();
    });
  });
});
