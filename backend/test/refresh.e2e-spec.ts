import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import request from 'supertest';
import { AuthTestApp, createAuthTestApp, TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';
const accessJwt = new JwtService({ secret: TEST_ACCESS_SECRET });
const refreshJwt = new JwtService({ secret: TEST_REFRESH_SECRET });

const setCookies = (res: request.Response): string[] => (res.headers['set-cookie'] as unknown as string[]) ?? [];
const find = (res: request.Response, name: string): string => setCookies(res).find((c) => c.startsWith(`${name}=`)) ?? '';
const valueOf = (cookie: string): string => cookie.split(';')[0].split('=')[1];

describe('POST /api/auth/refresh (e2e)', () => {
  let testApp: AuthTestApp;
  let app: INestApplication;
  let n = 0;

  const http = () => request(app.getHttpServer());
  const users = () => testApp.connection.collection('users');

  // Registers + logs in a fresh user (own email, so tests stay independent) and returns what the browser would hold.
  async function loginFresh() {
    const email = `user${++n}@example.com`;
    await http().post('/api/auth/register').send({ name: 'Ali', email, password: PASSWORD, acceptTerms: true }).expect(201);
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return {
      email,
      id: res.body.id as string,
      access: valueOf(find(res, 'access_token')),
      refresh: valueOf(find(res, 'refresh_token')),
    };
  }

  const refreshWith = (refresh?: string) => {
    const req = http().post('/api/auth/refresh');
    return refresh === undefined ? req : req.set('Cookie', `refresh_token=${refresh}`);
  };

  // Both cookies must be removed with the SAME path and flags they were set with, or the browser would keep them.
  function expectBothCleared(res: request.Response) {
    const access = find(res, 'access_token');
    const refresh = find(res, 'refresh_token');
    for (const cookie of [access, refresh]) {
      expect(cookie).toMatch(/^[a-z_]+=;/); // empty value
      expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/i); // already expired
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    }
    expect(access).toMatch(/Path=\/(;|$)/);
    expect(refresh).toMatch(/Path=\/api\/auth(;|$)/);
  }

  function expectInvalidSession(res: request.Response) {
    expect(res.body).toMatchObject({ statusCode: 401, message: 'Invalid or expired session', path: '/api/auth/refresh' });
    expectBothCleared(res);
  }

  beforeAll(async () => {
    testApp = await createAuthTestApp();
    app = testApp.app;
  }, 180_000);

  afterAll(() => testApp.close());

  it('valid refresh: 200, two NEW cookies with the right flags and paths, user in the body, no token in the body', async () => {
    const session = await loginFresh();
    const res = await refreshWith(session.refresh).expect(200);

    expect(setCookies(res).map((c) => c.split('=')[0]).sort()).toEqual(['access_token', 'refresh_token']);
    const access = find(res, 'access_token');
    const refresh = find(res, 'refresh_token');
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(access).toMatch(/Path=\/(;|$)/);
    expect(access).toMatch(/Max-Age=900(;|$)/);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=Lax/i);
    expect(refresh).toMatch(/Path=\/api\/auth(;|$)/);
    expect(refresh).toMatch(/Max-Age=1800(;|$)/);

    expect(valueOf(refresh)).not.toBe(session.refresh); // a new refresh token, not the old one echoed back
    expect(res.body).toMatchObject({ id: session.id, email: session.email, role: 'USER' });
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ|token|passwordHash/i);
  });

  it('needs no access cookie (it is @Public) and no body', async () => {
    const session = await loginFresh();
    await http().post('/api/auth/refresh').set('Cookie', `refresh_token=${session.refresh}`).send().expect(200);
  });

  it('the new access cookie works on GET /api/auth/me and /me matches the refresh response', async () => {
    const session = await loginFresh();
    const res = await refreshWith(session.refresh).expect(200);
    const me = await http().get('/api/auth/me').set('Cookie', `access_token=${valueOf(find(res, 'access_token'))}`).expect(200);
    expect(me.body).toEqual(res.body);
  });

  it('a refreshed session can be refreshed again (sliding window)', async () => {
    const session = await loginFresh();
    const first = await refreshWith(session.refresh).expect(200);
    await refreshWith(valueOf(find(first, 'refresh_token'))).expect(200);
  });

  it('two refresh tokens issued for the same user have different jti values', async () => {
    const session = await loginFresh();
    const second = await refreshWith(session.refresh).expect(200);
    const jti = async (token: string) => (await refreshJwt.verifyAsync<{ jti: string }>(token)).jti;
    const first = await jti(session.refresh);
    const next = await jti(valueOf(find(second, 'refresh_token')));
    expect(first).toEqual(expect.any(String));
    expect(next).toEqual(expect.any(String));
    expect(next).not.toBe(first);
  });

  it('a role change in the database shows up in the new access token', async () => {
    const session = await loginFresh();
    const airlineId = new Types.ObjectId();
    await users().updateOne(
      { _id: new Types.ObjectId(session.id) },
      { $set: { role: 'AIRLINE_MODERATOR', airlineId } },
    );

    const res = await refreshWith(session.refresh).expect(200);
    expect(accessJwt.decode(valueOf(find(res, 'access_token')))).toMatchObject({
      sub: session.id,
      role: 'AIRLINE_MODERATOR',
      airlineId: airlineId.toString(),
    });
    expect(res.body).toMatchObject({ role: 'AIRLINE_MODERATOR', airlineId: airlineId.toString() });
  });

  describe('invalid sessions: 401 "Invalid or expired session" and both cookies cleared', () => {
    it('no cookie', async () => {
      expectInvalidSession(await refreshWith().expect(401));
    });

    it('garbage cookie', async () => {
      expectInvalidSession(await refreshWith('not-a-jwt').expect(401));
    });

    it('tampered cookie (payload changed, signature kept)', async () => {
      const session = await loginFresh();
      const [header, , signature] = session.refresh.split('.');
      const forgedPayload = Buffer.from(JSON.stringify({ sub: new Types.ObjectId().toString() })).toString('base64url');
      expectInvalidSession(await refreshWith(`${header}.${forgedPayload}.${signature}`).expect(401));
    });

    it('expired refresh token', async () => {
      const session = await loginFresh();
      const expired = await refreshJwt.signAsync({ sub: session.id }, { expiresIn: -10 });
      expectInvalidSession(await refreshWith(expired).expect(401));
    });

    it('refresh token signed with the wrong secret', async () => {
      const session = await loginFresh();
      const forged = await new JwtService({ secret: 'some-other-secret-that-is-long-enough-123' }).signAsync({ sub: session.id });
      expectInvalidSession(await refreshWith(forged).expect(401));
    });

    it('an ACCESS token sent as the refresh cookie', async () => {
      const session = await loginFresh();
      expectInvalidSession(await refreshWith(session.access).expect(401));
    });

    it.each(['SUSPENDED', 'DEACTIVATED'])('user set to %s after login', async (status) => {
      const session = await loginFresh();
      await users().updateOne({ _id: new Types.ObjectId(session.id) }, { $set: { status } });
      expectInvalidSession(await refreshWith(session.refresh).expect(401));
    });

    it('user deleted after login', async () => {
      const session = await loginFresh();
      await users().deleteOne({ _id: new Types.ObjectId(session.id) });
      expectInvalidSession(await refreshWith(session.refresh).expect(401));
    });
  });
});
