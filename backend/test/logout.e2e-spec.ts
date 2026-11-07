import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AuthTestApp, createAuthTestApp, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';
const refreshJwt = new JwtService({ secret: TEST_REFRESH_SECRET });

const setCookies = (res: request.Response): string[] => (res.headers['set-cookie'] as unknown as string[]) ?? [];
const find = (res: request.Response, name: string): string => setCookies(res).find((c) => c.startsWith(`${name}=`)) ?? '';
const valueOf = (cookie: string): string => cookie.split(';')[0].split('=')[1];

// ACC-06 against a real (in-memory, disposable) MongoDB.
describe('POST /api/auth/logout (e2e)', () => {
  let testApp: AuthTestApp;
  let app: INestApplication;
  let n = 0;

  const http = () => request(app.getHttpServer());
  const revoked = () => testApp.connection.collection('revokedTokens');

  async function loginFresh() {
    const email = `logout${++n}@example.com`;
    await http().post('/api/auth/register').send({ name: 'Ali', email, password: PASSWORD, acceptTerms: true }).expect(201);
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { id: res.body.id as string, access: valueOf(find(res, 'access_token')), refresh: valueOf(find(res, 'refresh_token')) };
  }
  const logoutWith = (refresh?: string) => {
    const req = http().post('/api/auth/logout');
    return refresh === undefined ? req : req.set('Cookie', `refresh_token=${refresh}`);
  };
  const refreshWith = (refresh: string) => http().post('/api/auth/refresh').set('Cookie', `refresh_token=${refresh}`);

  function expectBothCleared(res: request.Response) {
    for (const cookie of [find(res, 'access_token'), find(res, 'refresh_token')]) {
      expect(cookie).toMatch(/^[a-z_]+=;/);
      expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    }
    // Same paths as when they were set, or the browser would keep them.
    expect(find(res, 'access_token')).toMatch(/Path=\/(;|$)/);
    expect(find(res, 'refresh_token')).toMatch(/Path=\/api\/auth(;|$)/);
  }

  beforeAll(async () => {
    testApp = await createAuthTestApp([], { swagger: true });
    app = testApp.app;
  });
  afterAll(() => testApp.close());
  beforeEach(() => revoked().deleteMany({}));

  it('logout then refresh with the old cookie returns 401', async () => {
    const session = await loginFresh();
    const out = await logoutWith(session.refresh).expect(200);
    expect(out.body).toEqual({ message: 'Logged out' });
    expectBothCleared(out);

    const res = await refreshWith(session.refresh).expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, message: 'Invalid or expired session' });
    expectBothCleared(res);
  });

  it('stores only the jti, the user and the token expiry (no token, so no secret)', async () => {
    const session = await loginFresh();
    await logoutWith(session.refresh).expect(200);
    const claims = refreshJwt.decode(session.refresh) as { jti: string; exp: number };
    const docs = await revoked().find({}).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].jti).toBe(claims.jti);
    expect(docs[0].userId.toString()).toBe(session.id);
    expect(docs[0].expiresAt.getTime()).toBe(claims.exp * 1000);
    expect(JSON.stringify(docs[0])).not.toContain(session.refresh);
  });

  it('logout without any session still returns 200 and clears the cookies', async () => {
    const res = await logoutWith().expect(200);
    expectBothCleared(res);
    expect(await revoked().countDocuments()).toBe(0);
  });

  it.each(['garbage', 'a.b.c'])('logout with an invalid refresh cookie (%s) is 200 and stores nothing', async (token) => {
    const res = await logoutWith(token).expect(200);
    expectBothCleared(res);
    expect(await revoked().countDocuments()).toBe(0);
  });

  it('logout with an already expired (but correctly signed) refresh cookie is 200 and stores nothing', async () => {
    const session = await loginFresh();
    const expired = await refreshJwt.signAsync({ sub: session.id }, { expiresIn: -10, jwtid: 'expired-jti' });
    const res = await logoutWith(expired).expect(200);
    expectBothCleared(res);
    expect(await revoked().countDocuments()).toBe(0);
  });

  it('refresh with a valid, unrevoked token still works', async () => {
    const session = await loginFresh();
    const res = await refreshWith(session.refresh).expect(200);
    expect(find(res, 'access_token')).toBeTruthy();
    expect(find(res, 'refresh_token')).toBeTruthy();
  });

  it('an access token is not accepted as a refresh token for logout (nothing stored)', async () => {
    const session = await loginFresh();
    await logoutWith(session.access).expect(200);
    expect(await revoked().countDocuments()).toBe(0);
  });

  it('logging out twice is fine and creates a single entry', async () => {
    const session = await loginFresh();
    await logoutWith(session.refresh).expect(200);
    await logoutWith(session.refresh).expect(200);
    expect(await revoked().countDocuments()).toBe(1);
  });

  it('parallel logouts with the same token do not fail or duplicate', async () => {
    const session = await loginFresh();
    const results = await Promise.all(Array.from({ length: 5 }, () => logoutWith(session.refresh)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await revoked().countDocuments()).toBe(1);
  });

  it('only the logged-out token is revoked: another user keeps refreshing', async () => {
    const a = await loginFresh();
    const b = await loginFresh();
    await logoutWith(a.refresh).expect(200);
    await refreshWith(a.refresh).expect(401);
    await refreshWith(b.refresh).expect(200);
  });

  it('a new login after logout works and its refresh token is not revoked', async () => {
    const first = await loginFresh();
    await logoutWith(first.refresh).expect(200);
    await new Promise((r) => setTimeout(r, 1100)); // a different iat/jti-bearing token
    const email = `logout${n}@example.com`;
    const again = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    await refreshWith(valueOf(find(again, 'refresh_token'))).expect(200);
  });

  it('the revocation collection has a TTL index on expiresAt so old entries are dropped', async () => {
    await loginFresh().then((s) => logoutWith(s.refresh));
    const indexes = await revoked().indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
        expect.objectContaining({ key: { jti: 1 }, unique: true }),
      ]),
    );
  });

  it('Swagger documents POST /api/auth/logout with a 200 response', async () => {
    const res = await http().get('/api/docs-json').expect(200);
    const operation = res.body.paths['/api/auth/logout']?.post;
    expect(operation).toBeDefined();
    expect(operation.responses['200']).toBeDefined();
  });
});
