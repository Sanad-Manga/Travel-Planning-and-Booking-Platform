import { INestApplication } from '@nestjs/common';
import { compare } from 'bcryptjs';
import request from 'supertest';
import { AuthTestApp, createAuthTestApp } from './helpers/auth-test-app';

const OLD = 'Passw0rdOK';
const NEW = 'N3wPassw0rd';

const setCookies = (res: request.Response): string[] => (res.headers['set-cookie'] as unknown as string[]) ?? [];
const cookieOf = (res: request.Response, name: string): string => setCookies(res).find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? '';

// ACC-08 against a real (in-memory, disposable) MongoDB.
describe('PATCH /api/auth/change-password (e2e)', () => {
  let testApp: AuthTestApp;
  let app: INestApplication;
  let n = 0;

  const http = () => request(app.getHttpServer());
  const users = () => testApp.connection.collection('users');

  async function loginFresh() {
    const email = `chg${++n}@example.com`;
    await http().post('/api/auth/register').send({ name: 'Ali', email, password: OLD, acceptTerms: true }).expect(201);
    const res = await http().post('/api/auth/login').send({ email, password: OLD }).expect(200);
    return { email, cookie: cookieOf(res, 'access_token') };
  }
  const change = (cookie: string, body: Record<string, unknown>) => http().patch('/api/auth/change-password').set('Cookie', cookie).send(body);
  const loginStatus = async (email: string, password: string) => (await http().post('/api/auth/login').send({ email, password })).status;
  const fieldsOf = (res: request.Response): string[] => (res.body.details ?? []).map((d: { field: string }) => d.field);

  beforeAll(async () => {
    testApp = await createAuthTestApp([], { swagger: true });
    app = testApp.app;
  });
  afterAll(() => testApp.close());

  it('changes the password: 204, the new one logs in, the old one no longer does', async () => {
    const { email, cookie } = await loginFresh();
    await change(cookie, { currentPassword: OLD, newPassword: NEW }).expect(204);
    expect(await loginStatus(email, NEW)).toBe(200);
    expect(await loginStatus(email, OLD)).toBe(401);
  });

  it('stores only a salted bcrypt hash: a different hash every time, never the plaintext', async () => {
    const a = await loginFresh();
    const b = await loginFresh();
    await change(a.cookie, { currentPassword: OLD, newPassword: NEW }).expect(204);
    await change(b.cookie, { currentPassword: OLD, newPassword: NEW }).expect(204);
    const docA = await users().findOne({ email: a.email });
    const docB = await users().findOne({ email: b.email });
    expect(docA?.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(docA?.passwordHash).not.toContain(NEW);
    expect(docA?.passwordHash).not.toBe(docB?.passwordHash); // same password, different salt
    await expect(compare(NEW, docA?.passwordHash)).resolves.toBe(true);
  });

  it('a wrong current password is a field-level 400 and the password is unchanged', async () => {
    const { email, cookie } = await loginFresh();
    const res = await change(cookie, { currentPassword: 'WrongPass1', newPassword: NEW }).expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, path: '/api/auth/change-password', details: [{ field: 'currentPassword' }] });
    expect(await loginStatus(email, OLD)).toBe(200);
    expect(await loginStatus(email, NEW)).toBe(401);
  });

  it.each([
    ['too short', 'ab1', 'newPassword'],
    ['no digit', 'abcdefghij', 'newPassword'],
    ['no letter', '1234567890', 'newPassword'],
    ['not a string', 12345678, 'newPassword'],
  ])('a new password that breaks the rules (%s) is a field-level 400', async (_label, newPassword, field) => {
    const { email, cookie } = await loginFresh();
    const res = await change(cookie, { currentPassword: OLD, newPassword }).expect(400);
    expect(fieldsOf(res)).toContain(field);
    expect(await loginStatus(email, OLD)).toBe(200);
  });

  it('accepts an Arabic letters-plus-digit new password', async () => {
    const { email, cookie } = await loginFresh();
    await change(cookie, { currentPassword: OLD, newPassword: 'كلمةالسر1' }).expect(204);
    expect(await loginStatus(email, 'كلمةالسر1')).toBe(200);
  });

  it('a new password over 72 bytes is a field-level 400 naming newPassword', async () => {
    const { cookie } = await loginFresh();
    const res = await change(cookie, { currentPassword: OLD, newPassword: 'a'.repeat(72) + '1' }).expect(400);
    expect(fieldsOf(res)).toContain('newPassword');
  });

  it('a current password over 72 bytes is a field-level 400 on currentPassword (never sent to bcrypt)', async () => {
    const { cookie } = await loginFresh();
    const res = await change(cookie, { currentPassword: 'a'.repeat(73), newPassword: NEW }).expect(400);
    expect(fieldsOf(res)).toEqual(['currentPassword']);
  });

  it('empty strings are field-level 400s on both fields', async () => {
    const { cookie } = await loginFresh();
    const res = await change(cookie, { currentPassword: '', newPassword: '' }).expect(400);
    expect(fieldsOf(res)).toEqual(expect.arrayContaining(['currentPassword', 'newPassword']));
  });

  it('a wrong current password leaves the stored hash byte-for-byte unchanged', async () => {
    const { email, cookie } = await loginFresh();
    const before = (await users().findOne({ email }))?.passwordHash;
    await change(cookie, { currentPassword: 'WrongPass1', newPassword: NEW }).expect(400);
    expect((await users().findOne({ email }))?.passwordHash).toBe(before);
  });

  it('a successful change gives a new hash, different from the previous one', async () => {
    const { email, cookie } = await loginFresh();
    const before = (await users().findOne({ email }))?.passwordHash;
    await change(cookie, { currentPassword: OLD, newPassword: NEW }).expect(204);
    const after = (await users().findOne({ email }))?.passwordHash;
    expect(after).not.toBe(before);
    expect(after).not.toBe(NEW);
  });

  it('missing fields and unknown fields are 400 (whitelist)', async () => {
    const { cookie } = await loginFresh();
    const missing = await change(cookie, {}).expect(400);
    expect(fieldsOf(missing)).toEqual(expect.arrayContaining(['currentPassword', 'newPassword']));
    await change(cookie, { currentPassword: OLD, newPassword: NEW, role: 'ADMIN' }).expect(400);
  });

  it('401 when not logged in', async () => {
    await http().patch('/api/auth/change-password').send({ currentPassword: OLD, newPassword: NEW }).expect(401);
  });

  it('only changes the caller: another user keeps their password', async () => {
    const a = await loginFresh();
    const b = await loginFresh();
    await change(a.cookie, { currentPassword: OLD, newPassword: NEW }).expect(204);
    expect(await loginStatus(b.email, OLD)).toBe(200);
  });

  it('the response never contains a password or hash', async () => {
    const { cookie } = await loginFresh();
    const ok = await change(cookie, { currentPassword: OLD, newPassword: NEW }).expect(204);
    expect(ok.text).toBe('');
    const bad = await change(cookie, { currentPassword: 'WrongPass1', newPassword: NEW }).expect(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/passwordHash|\$2[aby]\$|Passw0rdOK|N3wPassw0rd/);
  });

  it('parallel changes from the same old password cannot both win (compare-and-set)', async () => {
    const { email, cookie } = await loginFresh();
    const candidates = ['N3wPassw0rdA', 'N3wPassw0rdB', 'N3wPassw0rdC', 'N3wPassw0rdD'];
    const results = await Promise.all(candidates.map((newPassword) => change(cookie, { currentPassword: OLD, newPassword })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 204)).toHaveLength(1);
    expect(statuses.filter((s) => s === 204 || s === 409 || s === 400)).toHaveLength(4); // losers: 409, or 400 if they read after the winner
    // exactly the winner's password works
    const winner = candidates[statuses.indexOf(204)];
    expect(await loginStatus(email, winner)).toBe(200);
    expect(await loginStatus(email, OLD)).toBe(401);
  });

  it('registration still enforces the same shared rule', async () => {
    const res = await http().post('/api/auth/register').send({ name: 'W', email: 'weak@example.com', password: 'abcdefgh', acceptTerms: true }).expect(400);
    expect(fieldsOf(res)).toContain('password');
  });

  it('Swagger documents PATCH /api/auth/change-password with 204, 400, 401 and 409', async () => {
    const res = await http().get('/api/docs-json').expect(200);
    const operation = res.body.paths['/api/auth/change-password']?.patch;
    expect(operation).toBeDefined();
    expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining(['204', '400', '401', '409']));
    expect(operation.security).toBeDefined();
  });
});
