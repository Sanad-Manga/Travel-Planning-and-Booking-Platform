import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { BookingType, Role } from '../src/common';
import { setupApp } from '../src/setup-app';
import { UpcomingBookingsRegistry } from '../src/users/upcoming-bookings';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';
import { expectSameCookieIdentity, recordCookieFlow } from './helpers/cookie-compare';

const PASSWORD = 'Passw0rdOK';
const GENERIC_LOGIN_ERROR = 'Invalid email or password';

const setCookies = (res: request.Response): string[] => (res.headers['set-cookie'] as unknown as string[]) ?? [];
const find = (res: request.Response, name: string): string => setCookies(res).find((c) => c.startsWith(`${name}=`)) ?? '';
const valueOf = (cookie: string): string => cookie.split(';')[0].split('=')[1];

// ACC-12 against a real (in-memory, disposable) MongoDB and the whole AppModule. Atlas is never touched.
// The booking check is a TEST DOUBLE: Flights B / Hotels B have not registered their checkers yet.
describe('DELETE /api/users/me (ACC-12, e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  const upcoming = new Set<string>(); // user ids the fake booking owner reports as having an upcoming CONFIRMED booking
  let n = 0;

  const http = () => request(app.getHttpServer());
  const users = () => connection.collection('users');
  const jwt = new JwtService({ secret: TEST_ACCESS_SECRET });
  const statusOf = async (id: string) => (await users().findOne({ _id: new Types.ObjectId(id) }))?.status;

  async function signup() {
    const email = `acc12-${++n}@example.com`;
    await http().post('/api/auth/register').send({ name: `Ali ${n}`, email, password: PASSWORD, acceptTerms: true }).expect(201);
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { id: res.body.id as string, email, name: res.body.name as string, cookie: `access_token=${valueOf(find(res, 'access_token'))}`, refresh: valueOf(find(res, 'refresh_token')) };
  }
  async function cookieForRole(role: Role, extra: Record<string, unknown> = {}) {
    const { insertedId } = await users().insertOne({
      name: `Staff ${role}`,
      email: `${role.toLowerCase()}-${++n}@acc12.test`,
      passwordHash: 'not-used',
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    const token = await jwt.signAsync({ sub: insertedId.toHexString(), role, ...extra }, { expiresIn: '10m' });
    return { id: insertedId.toHexString(), cookie: `access_token=${token}` };
  }
  const NO_BODY = Symbol('no body');
  const deactivate = (cookie?: string, body: unknown = { confirm: true }) => {
    const req = http().delete('/api/users/me');
    if (cookie) req.set('Cookie', cookie);
    return body === NO_BODY ? req : req.send(body as object);
  };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); // a replica set: blog comments use transactions
    // Set BEFORE AppModule is imported so nothing from backend/.env (e.g. the shared Atlas URI) can win.
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    expect(process.env.MONGODB_URI).toMatch(/^mongodb:\/\/127\.0\.0\.1:/);

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();

    // The documented seam: a booking owner registers its checker. Here the owner is a test double.
    app.get(UpcomingBookingsRegistry).register(BookingType.FLIGHT, {
      hasUpcomingConfirmedBookings: (userId) => Promise.resolve(upcoming.has(userId)),
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('confirmation (real body validation)', () => {
    it.each([
      ['no body at all', NO_BODY],
      ['empty body', {}],
      ['confirm: false', { confirm: false }],
      ['confirm: "true" (string)', { confirm: 'true' }],
      ['an unknown field', { confirm: true, role: 'ADMIN' }],
    ])('%s -> 400 with details, user stays ACTIVE', async (_label, body) => {
      const me = await signup();
      const res = await deactivate(me.cookie, body).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', message: 'Validation failed', path: '/api/users/me' });
      expect(res.body.details.length).toBeGreaterThan(0);
      for (const d of res.body.details) expect(d).toEqual({ field: expect.any(String), message: expect.any(String) });
      expect(await statusOf(me.id)).toBe('ACTIVE');
    });

    it('a request with NO body at all -> standard 400 with a details entry for confirm, user stays ACTIVE', async () => {
      const me = await signup();
      const res = await http().delete('/api/users/me').set('Cookie', me.cookie).expect(400); // nothing sent: no body, no content-type
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', message: 'Validation failed', path: '/api/users/me' });
      expect(res.body.details).toEqual([{ field: 'confirm', message: 'confirm must be true to deactivate your account' }]);
      expect(await statusOf(me.id)).toBe('ACTIVE');
    });

    it('reports the confirm field by name', async () => {
      const me = await signup();
      const res = await deactivate(me.cookie, { confirm: false }).expect(400);
      expect(res.body.details).toEqual([{ field: 'confirm', message: 'confirm must be true to deactivate your account' }]);
    });
  });

  describe('upcoming bookings', () => {
    it('an upcoming CONFIRMED booking -> 409, clear message, no ids or personal data, user stays ACTIVE and can still use the session', async () => {
      const me = await signup();
      upcoming.add(me.id);
      const res = await deactivate(me.cookie).expect(409);
      expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict', path: '/api/users/me' });
      expect(res.body.message).toMatch(/upcoming confirmed bookings/i);
      expect(JSON.stringify(res.body)).not.toContain(me.id);
      expect(JSON.stringify(res.body)).not.toContain(me.email);
      expect(await statusOf(me.id)).toBe('ACTIVE');
      await http().get('/api/users/me').set('Cookie', me.cookie).expect(200);
    });

    it('once the booking is cancelled or over (the owner answers false) the same user can deactivate', async () => {
      const me = await signup();
      upcoming.add(me.id);
      await deactivate(me.cookie).expect(409);
      upcoming.delete(me.id);
      await deactivate(me.cookie).expect(200);
      expect(await statusOf(me.id)).toBe('DEACTIVATED');
    });
  });

  describe('success', () => {
    it('200, status DEACTIVATED, cookies cleared, data kept; old token -> 401; login -> generic 401 with counters untouched; second call -> 401', async () => {
      const me = await signup();
      const res = await deactivate(me.cookie).expect(200);
      expect(res.body).toEqual({ message: 'Account deactivated' });

      for (const cookie of [find(res, 'access_token'), find(res, 'refresh_token')]) {
        expect(cookie).toMatch(/^[a-z_]+=;/);
        expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
        expect(cookie).toMatch(/HttpOnly/i);
      }
      expect(find(res, 'access_token')).toMatch(/Path=\/(;|$)/);
      expect(find(res, 'refresh_token')).toMatch(/Path=\/api\/auth(;|$)/);

      // Nothing is deleted.
      const stored = await users().findOne({ _id: new Types.ObjectId(me.id) });
      expect(stored).toMatchObject({ status: 'DEACTIVATED', email: me.email, role: 'USER' });

      // The old access cookie stops working at once (JwtAuthGuard checks the status on every request).
      for (const path of ['/api/users/me', '/api/auth/me']) {
        const old = await http().get(path).set('Cookie', me.cookie).expect(401);
        expect(old.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
      }

      // Login: the same generic 401 as a wrong password, and the lockout counters are not touched.
      const afterDeactivation = await http().post('/api/auth/login').send({ email: me.email, password: PASSWORD }).expect(401);
      expect(afterDeactivation.body.message).toBe(GENERIC_LOGIN_ERROR);
      expect(find(afterDeactivation, 'access_token')).toBe('');
      const afterLogin = await users().findOne({ _id: new Types.ObjectId(me.id) });
      expect(afterLogin?.failedAttempts ?? 0).toBe(0); // the correct-password attempt did not count as a failure
      expect(afterLogin?.lockedUntil).toBeUndefined();
      const wrongPassword = await http().post('/api/auth/login').send({ email: me.email, password: 'Wr0ngPassword' }).expect(401);
      expect(wrongPassword.body.message).toBe(afterDeactivation.body.message); // indistinguishable from a wrong password

      // A second call cannot succeed.
      await deactivate(me.cookie).expect(401);
    });

    it('deactivation clears BOTH cookies with the same Path, HttpOnly, SameSite and Secure as login sets and logout clears (COOKIE_SECURE=false)', async () => {
      const flow = await recordCookieFlow(app, 'plain-cookies@example.com');
      expectSameCookieIdentity(flow, false);
    });

    it('a deactivated user cannot refresh: the old refresh cookie gets the standard 401 and no new cookies', async () => {
      const me = await signup();
      await http().post('/api/auth/refresh').set('Cookie', `refresh_token=${me.refresh}`).expect(200); // valid before
      await deactivate(me.cookie).expect(200);
      const res = await http().post('/api/auth/refresh').set('Cookie', `refresh_token=${me.refresh}`).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired session', path: '/api/auth/refresh' });
      expect(find(res, 'access_token')).toMatch(/^access_token=;/); // cleared, not renewed
      expect(find(res, 'refresh_token')).toMatch(/^refresh_token=;/);
    });

    it('a concurrent double call changes the status once (one 200, the other 401)', async () => {
      const me = await signup();
      const results = await Promise.all([deactivate(me.cookie), deactivate(me.cookie)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      expect(await statusOf(me.id)).toBe('DEACTIVATED');
    });
  });

  describe('authentication and roles', () => {
    it('a guest gets 401', async () => {
      await deactivate(undefined).expect(401);
    });

    it.each([
      [Role.ADMIN, {}],
      [Role.AIRLINE_MODERATOR, { airlineId: new Types.ObjectId().toHexString() }],
      [Role.HOTEL_MODERATOR, { hotelId: new Types.ObjectId().toHexString() }],
    ])('%s gets 403 and stays ACTIVE', async (role, extra) => {
      const staff = await cookieForRole(role, extra);
      const res = await deactivate(staff.cookie).expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
      expect(await statusOf(staff.id)).toBe('ACTIVE');
    });
  });

  // READ-ONLY proofs of what other modules ALREADY do for a DEACTIVATED author (no other module is edited).
  describe('what other modules already do for a deactivated author', () => {
    it("their comment shows as 'Deleted user' to other readers (blog, BLG-05)", async () => {
      const writer = await signup();
      const commenter = await signup();
      const post = await http().post('/api/posts').set('Cookie', writer.cookie).send({ title: 'Cairo', body: 'Pyramids.', status: 'PUBLISHED' }).expect(201);
      await http().post(`/api/posts/${post.body.id}/comments`).set('Cookie', commenter.cookie).send({ body: 'Great post' }).expect(201);

      const before = await http().get(`/api/posts/${post.body.id}/comments`).set('Cookie', writer.cookie).expect(200);
      expect(before.body.items[0].author.name).toBe(commenter.name);
      expect(before.body.items[0].author.name).not.toBe('Deleted user');

      await deactivate(commenter.cookie).expect(200);
      const after = await http().get(`/api/posts/${post.body.id}/comments`).set('Cookie', writer.cookie).expect(200);
      expect(after.body.items[0].author).toEqual({ id: commenter.id, name: 'Deleted user' });
      expect(after.body.items[0].body).toBe('Great post');
    });

    it('their PUBLIC itinerary leaves the public search (itineraries, ITN-20)', async () => {
      const owner = await signup();
      const now = new Date();
      const { insertedId } = await connection.collection('itineraries').insertOne({
        authorId: new Types.ObjectId(owner.id),
        title: 'Two weeks in Egypt',
        countryCodes: ['EG'],
        startDate: '2027-01-10',
        visibility: 'PUBLIC',
        isHidden: false,
        days: [],
        createdAt: now,
        updatedAt: now,
      });
      const ids = async () => (await http().get('/api/itineraries/public/search?limit=50').expect(200)).body.items.map((i: { id: string }) => i.id);

      expect(await ids()).toContain(insertedId.toHexString());
      await deactivate(owner.cookie).expect(200);
      expect(await ids()).not.toContain(insertedId.toHexString());
    });
  });
});
