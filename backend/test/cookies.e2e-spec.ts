import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AuthTestApp, createAuthTestApp, TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';
const USER = { name: 'Ali', email: 'ali@example.com', password: PASSWORD, acceptTerms: true };

const setCookies = (res: request.Response): string[] => (res.headers['set-cookie'] as unknown as string[]) ?? [];
const find = (res: request.Response, name: string): string => setCookies(res).find((c) => c.startsWith(`${name}=`)) ?? '';
const valueOf = (cookie: string): string => cookie.split(';')[0].split('=')[1];

async function loginOn(app: INestApplication): Promise<request.Response> {
  await request(app.getHttpServer()).post('/api/auth/register').send(USER);
  return request(app.getHttpServer()).post('/api/auth/login').send({ email: USER.email, password: PASSWORD }).expect(200);
}

describe('auth cookies, local http (COOKIE_SECURE=false) (e2e)', () => {
  let testApp: AuthTestApp;
  let loginRes: request.Response;

  beforeAll(async () => {
    testApp = await createAuthTestApp([], { swagger: true });
    loginRes = await loginOn(testApp.app);
  }, 180_000);

  afterAll(() => testApp.close());

  it('sets exactly the two auth cookies on login', () => {
    expect(setCookies(loginRes).map((c) => c.split('=')[0]).sort()).toEqual(['access_token', 'refresh_token']);
  });

  it('access cookie: httpOnly, SameSite=Lax, Path=/, 15 minutes', () => {
    const cookie = find(loginRes, 'access_token');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/(;|$)/);
    expect(cookie).toMatch(/Max-Age=900(;|$)/);
    expect(cookie).not.toMatch(/Secure/i); // plain http in local dev
  });

  it('refresh cookie: httpOnly, SameSite=Lax, Path=/api/auth, 30 minutes', () => {
    const cookie = find(loginRes, 'refresh_token');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth(;|$)/);
    expect(cookie).toMatch(/Max-Age=1800(;|$)/);
  });

  it('the two tokens are signed with different secrets and carry the right claims', async () => {
    const access = valueOf(find(loginRes, 'access_token'));
    const refresh = valueOf(find(loginRes, 'refresh_token'));
    const accessClaims = await new JwtService({ secret: TEST_ACCESS_SECRET }).verifyAsync(access);
    expect(accessClaims).toMatchObject({ sub: loginRes.body.id, role: 'USER' });
    expect(accessClaims.exp - accessClaims.iat).toBe(900);
    const refreshClaims = await new JwtService({ secret: TEST_REFRESH_SECRET }).verifyAsync(refresh);
    expect(refreshClaims.sub).toBe(loginRes.body.id);
    expect(refreshClaims.exp - refreshClaims.iat).toBe(1800);
    await expect(new JwtService({ secret: TEST_ACCESS_SECRET }).verifyAsync(refresh)).rejects.toThrow();
  });

  it('a refresh token cannot be used as an access token', async () => {
    const refresh = valueOf(find(loginRes, 'refresh_token'));
    await request(testApp.app.getHttpServer()).get('/api/auth/me').set('Cookie', `access_token=${refresh}`).expect(401);
  });

  it('no token appears in any response body (register, login, me, errors)', async () => {
    const server = testApp.app.getHttpServer();
    const access = valueOf(find(loginRes, 'access_token'));
    const refresh = valueOf(find(loginRes, 'refresh_token'));
    const me = await request(server).get('/api/auth/me').set('Cookie', `access_token=${access}`).expect(200);
    const bad = await request(server).post('/api/auth/login').send({ email: USER.email, password: 'WrongPass1' }).expect(401);
    const dup = await request(server).post('/api/auth/register').send(USER).expect(409);

    for (const res of [loginRes, me, bad, dup]) {
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(access);
      expect(body).not.toContain(refresh);
      expect(body).not.toMatch(/eyJ/); // every JWT starts with this base64 header
      expect(body).not.toMatch(/token/i);
    }
  });

  it('a browser-like client (cookie jar) is logged in after login, with no Authorization header', async () => {
    const browser = request.agent(testApp.app.getHttpServer());
    await browser.post('/api/auth/login').send({ email: USER.email, password: PASSWORD }).expect(200);
    const me = await browser.get('/api/auth/me').expect(200);
    expect(me.body.email).toBe(USER.email);
  });

  it('Swagger: documents the cookie scheme with the real cookie name and /me uses it', async () => {
    const res = await request(testApp.app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(res.body.components.securitySchemes.cookie).toEqual({ type: 'apiKey', in: 'cookie', name: 'access_token' });
    expect(res.body.paths['/api/auth/me'].get.security).toEqual([{ cookie: [] }]);
    expect(res.body.paths['/api/auth/login'].post.security).toBeUndefined();
  });
});

describe('auth cookies in production (COOKIE_SECURE=true) (e2e)', () => {
  let testApp: AuthTestApp;

  beforeAll(async () => {
    testApp = await createAuthTestApp([], { cookieSecure: true });
  }, 180_000);

  afterAll(() => testApp.close());

  it('both cookies carry the Secure flag', async () => {
    const res = await loginOn(testApp.app);
    expect(find(res, 'access_token')).toMatch(/; Secure/i);
    expect(find(res, 'refresh_token')).toMatch(/; Secure/i);
    expect(find(res, 'access_token')).toMatch(/HttpOnly/i);
  });
});
