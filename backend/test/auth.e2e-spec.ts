import { Controller, Get, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import request from 'supertest';
import { AuthenticatedUser, CurrentUser, Public, Role, Roles } from '../src/common';
import { AuthTestApp, createAuthTestApp, TEST_ACCESS_SECRET } from './helpers/auth-test-app';

// Test-only routes so the global guards can be exercised without depending on other modules.
@Controller('probe')
class ProbeController {
  @Public()
  @Get('public')
  open() {
    return { ok: true };
  }

  @Get('any-user')
  anyUser(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Roles(Role.ADMIN)
  @Get('admin-only')
  adminOnly() {
    return { ok: true };
  }
}

describe('login, /me and the global guards (e2e)', () => {
  let testApp: AuthTestApp;
  let app: INestApplication;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const login = (email: string, password = PASSWORD) => http().post('/api/auth/login').send({ email, password });
  const cookieOf = (res: request.Response, name: string): string =>
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith(`${name}=`)) ?? '';
  const tokenFrom = (res: request.Response): string => cookieOf(res, 'access_token').split(';')[0];

  // Inserts users straight into MongoDB so we can create roles/statuses that registration never allows.
  const insertUser = (email: string, extra: Record<string, unknown> = {}) =>
    testApp.connection.collection('users').insertOne({
      name: 'Seeded',
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.USER,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });

  beforeAll(async () => {
    testApp = await createAuthTestApp([ProbeController]);
    app = testApp.app;
    await http().post('/api/auth/register').send({ name: 'Ali', email: 'ali@example.com', password: PASSWORD, acceptTerms: true });
    await insertUser('admin@example.com', { role: Role.ADMIN });
    await insertUser('suspended@example.com', { status: 'SUSPENDED' });
    await insertUser('deactivated@example.com', { status: 'DEACTIVATED' });
    await insertUser('mod@example.com', { role: Role.AIRLINE_MODERATOR, airlineId: new Types.ObjectId() });
  }, 180_000);

  afterAll(() => testApp.close());

  describe('POST /api/auth/login', () => {
    it('logs in: 200, httpOnly access cookie, no token in the body', async () => {
      const res = await login('ali@example.com').expect(200);
      const cookie = cookieOf(res, 'access_token');
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
      expect(res.body).toMatchObject({ email: 'ali@example.com', role: 'USER' });
      expect(JSON.stringify(res.body)).not.toMatch(/token|passwordHash|eyJ/i);
    });

    it('accepts the email in any case', async () => {
      await login(' ALI@example.com ').expect(200);
    });

    it('wrong password -> 401 with the generic message', async () => {
      const res = await login('ali@example.com', 'WrongPass1').expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('unknown email -> the same 401 message', async () => {
      const res = await login('nobody@example.com').expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('suspended account with the right password -> 403 "Account suspended"', async () => {
      const res = await login('suspended@example.com').expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, message: 'Account suspended' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('suspended account with a wrong password -> generic 401 (status is not revealed)', async () => {
      const res = await login('suspended@example.com', 'WrongPass1').expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('deactivated account -> generic 401', async () => {
      const res = await login('deactivated@example.com').expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects a malformed body with field-level 400', async () => {
      const res = await http().post('/api/auth/login').send({ email: 'x' }).expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['email', 'password']));
    });
  });

  describe('GET /api/auth/me', () => {
    it('without a cookie -> 401 in the error shape', async () => {
      const res = await http().get('/api/auth/me').expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized', path: '/api/auth/me' });
    });

    it('with a garbage cookie -> 401', async () => {
      await http().get('/api/auth/me').set('Cookie', 'access_token=not-a-jwt').expect(401);
    });

    it('with a token signed by another secret -> 401', async () => {
      const forged = await new JwtService({ secret: 'some-other-secret-that-is-long-enough-123' }).signAsync({
        sub: '6730a1f2c3d4e5f607182930',
        role: Role.ADMIN,
      });
      await http().get('/api/auth/me').set('Cookie', `access_token=${forged}`).expect(401);
    });

    it('with an expired token -> 401', async () => {
      const expired = await new JwtService({ secret: TEST_ACCESS_SECRET }).signAsync(
        { sub: '6730a1f2c3d4e5f607182930', role: Role.USER },
        { expiresIn: -10 },
      );
      await http().get('/api/auth/me').set('Cookie', `access_token=${expired}`).expect(401);
    });

    it('after login, the cookie returns the current user', async () => {
      const loginRes = await login('ali@example.com').expect(200);
      const res = await http().get('/api/auth/me').set('Cookie', tokenFrom(loginRes)).expect(200);
      expect(res.body).toMatchObject({ email: 'ali@example.com', role: 'USER', status: 'ACTIVE' });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    });
  });

  describe('global guards', () => {
    it('a public route works without a cookie', async () => {
      await http().get('/api/probe/public').expect(200);
    });

    it('a normal route without a cookie -> 401', async () => {
      await http().get('/api/probe/any-user').expect(401);
    });

    it('@CurrentUser returns { userId, role } and moderators carry their airlineId', async () => {
      const mod = await login('mod@example.com').expect(200);
      const res = await http().get('/api/probe/any-user').set('Cookie', tokenFrom(mod)).expect(200);
      expect(res.body).toEqual({ userId: mod.body.id, role: 'AIRLINE_MODERATOR', airlineId: mod.body.airlineId, tokenVersion: 0 });
    });

    it('@Roles(ADMIN): a USER gets 403', async () => {
      const user = await login('ali@example.com').expect(200);
      const res = await http().get('/api/probe/admin-only').set('Cookie', tokenFrom(user)).expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
    });

    it('@Roles(ADMIN): an ADMIN gets 200', async () => {
      const admin = await login('admin@example.com').expect(200);
      await http().get('/api/probe/admin-only').set('Cookie', tokenFrom(admin)).expect(200);
    });
  });

  // The access token is valid for 15 minutes, but the guard also checks the account on every request,
  // so changing the account status in the database takes effect on the very next request.
  describe('account status is re-checked on every request', () => {
    const setStatus = (email: string, status: string) =>
      testApp.connection.collection('users').updateOne({ email }, { $set: { status } });

    it.each(['SUSPENDED', 'DEACTIVATED'])('a user who is %s after logging in gets 401 on the next request', async (status) => {
      const email = `status-${status.toLowerCase()}@example.com`;
      await insertUser(email);
      const session = await login(email).expect(200);
      const cookie = tokenFrom(session);

      await http().get('/api/probe/any-user').set('Cookie', cookie).expect(200);
      await setStatus(email, status);

      const res = await http().get('/api/probe/any-user').set('Cookie', cookie).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized', path: '/api/probe/any-user' });
      await http().get('/api/auth/me').set('Cookie', cookie).expect(401);
    });

    it('a suspended admin is 401 on an @Roles(ADMIN) route, not 200', async () => {
      await insertUser('admin-to-suspend@example.com', { role: Role.ADMIN });
      const cookie = tokenFrom(await login('admin-to-suspend@example.com').expect(200));
      await http().get('/api/probe/admin-only').set('Cookie', cookie).expect(200);

      await setStatus('admin-to-suspend@example.com', 'SUSPENDED');
      await http().get('/api/probe/admin-only').set('Cookie', cookie).expect(401);
    });

    it('reactivating the account makes the same cookie work again', async () => {
      await insertUser('reactivated@example.com');
      const cookie = tokenFrom(await login('reactivated@example.com').expect(200));

      await setStatus('reactivated@example.com', 'SUSPENDED');
      await http().get('/api/probe/any-user').set('Cookie', cookie).expect(401);
      await setStatus('reactivated@example.com', 'ACTIVE');
      await http().get('/api/probe/any-user').set('Cookie', cookie).expect(200);
    });

    it('a correctly signed token for a user that no longer exists -> 401', async () => {
      const ghost = await new JwtService({ secret: TEST_ACCESS_SECRET }).signAsync({
        sub: new Types.ObjectId().toHexString(),
        role: Role.USER,
      });
      await http().get('/api/probe/any-user').set('Cookie', `access_token=${ghost}`).expect(401);
    });

    it('public routes still work for everyone', async () => {
      await http().get('/api/probe/public').expect(200);
    });
  });
});
