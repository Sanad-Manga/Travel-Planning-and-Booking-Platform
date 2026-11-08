import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthTestApp, createAuthTestApp } from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';
const setCookies = (res: request.Response): string[] => (res.headers['set-cookie'] as unknown as string[]) ?? [];
const accessCookie = (res: request.Response): string => setCookies(res).find((c) => c.startsWith('access_token='))?.split(';')[0] ?? '';

// ACC-09 against a real (in-memory, disposable) MongoDB with throwaway currency rows.
describe('GET/PATCH /api/users/me (e2e)', () => {
  let testApp: AuthTestApp;
  let app: INestApplication;
  let n = 0;

  const http = () => request(app.getHttpServer());
  const users = () => testApp.connection.collection('users');
  const fieldsOf = (res: request.Response): string[] => (res.body.details ?? []).map((d: { field: string }) => d.field);

  async function loginFresh() {
    const email = `profile${++n}@example.com`;
    await http().post('/api/auth/register').send({ name: 'Ali Hassan', email, password: PASSWORD, acceptTerms: true }).expect(201);
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { email, id: res.body.id as string, cookie: accessCookie(res) };
  }
  const get = (cookie: string) => http().get('/api/users/me').set('Cookie', cookie);
  const patch = (cookie: string, body: Record<string, unknown>) => http().patch('/api/users/me').set('Cookie', cookie).send(body);
  const stored = (email: string) => users().findOne({ email });

  beforeAll(async () => {
    testApp = await createAuthTestApp([], { swagger: true });
    app = testApp.app;
    // The "supported currencies" (GEN-12 reference data). Only a few throwaway codes are needed.
    await testApp.connection.collection('currencies').insertMany(
      ['USD', 'EUR', 'EGP', 'JPY'].map((code) => ({ code, createdAt: new Date(), updatedAt: new Date() })),
    );
  });
  afterAll(() => testApp.close());

  describe('GET /api/users/me', () => {
    it('returns the profile of the logged-in user, without any hash', async () => {
      const { email, id, cookie } = await loginFresh();
      const res = await get(cookie).expect(200);
      expect(res.body).toMatchObject({ id, email, name: 'Ali Hassan', role: 'USER', status: 'ACTIVE', preferredCurrency: 'USD' });
      expect(res.body).not.toHaveProperty('phone');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    });

    it('401 without a cookie', async () => {
      await http().get('/api/users/me').expect(401);
    });

    it('GET /api/auth/me still works and shows the same profile', async () => {
      const { cookie } = await loginFresh();
      await patch(cookie, { phone: '+201001234567' }).expect(200);
      const res = await http().get('/api/auth/me').set('Cookie', cookie).expect(200);
      expect(res.body.phone).toBe('+201001234567');
    });
  });

  describe('PATCH /api/users/me', () => {
    it('401 without a cookie', async () => {
      await http().patch('/api/users/me').send({ name: 'X' }).expect(401);
    });

    it('updates name, phone and preferred currency together and returns the new profile', async () => {
      const { email, cookie } = await loginFresh();
      const res = await patch(cookie, { name: '  Sara Ali ', phone: '+20 100-123-4567', preferredCurrency: 'eur' }).expect(200);
      expect(res.body).toMatchObject({ name: 'Sara Ali', phone: '+201001234567', preferredCurrency: 'EUR', email });
      const doc = await stored(email);
      expect(doc).toMatchObject({ name: 'Sara Ali', phone: '+201001234567', preferredCurrency: 'EUR' });
      expect((await get(cookie).expect(200)).body).toMatchObject({ name: 'Sara Ali', phone: '+201001234567', preferredCurrency: 'EUR' });
    });

    it('a partial update changes only the fields sent', async () => {
      const { email, cookie } = await loginFresh();
      await patch(cookie, { preferredCurrency: 'EGP' }).expect(200);
      expect(await stored(email)).toMatchObject({ name: 'Ali Hassan', preferredCurrency: 'EGP' });
    });

    it('an empty phone removes the phone number', async () => {
      const { email, cookie } = await loginFresh();
      await patch(cookie, { phone: '+201001234567' }).expect(200);
      const res = await patch(cookie, { phone: '' }).expect(200);
      expect(res.body).not.toHaveProperty('phone');
      expect(await stored(email)).not.toHaveProperty('phone');
    });

    describe('one invalid field means nothing is saved', () => {
      it('valid name + unsupported currency: 400 on preferredCurrency, name unchanged', async () => {
        const { email, cookie } = await loginFresh();
        const before = await stored(email);
        const res = await patch(cookie, { name: 'Changed Name', phone: '+201001234567', preferredCurrency: 'ZZZ' }).expect(400);
        expect(res.body).toMatchObject({
          statusCode: 400,
          error: 'Bad Request',
          path: '/api/users/me',
          details: [{ field: 'preferredCurrency', message: expect.any(String) }],
        });
        expect(await stored(email)).toEqual(before); // byte-for-byte: name, phone, currency, updatedAt
      });

      it('valid currency + invalid phone: 400 on phone, currency unchanged', async () => {
        const { email, cookie } = await loginFresh();
        const before = await stored(email);
        const res = await patch(cookie, { preferredCurrency: 'EUR', phone: 'not-a-phone' }).expect(400);
        expect(fieldsOf(res)).toEqual(['phone']);
        expect(await stored(email)).toEqual(before);
      });

      it('valid phone + empty name: 400 on name, phone not saved', async () => {
        const { email, cookie } = await loginFresh();
        const before = await stored(email);
        const res = await patch(cookie, { name: '   ', phone: '+201001234567' }).expect(400);
        expect(fieldsOf(res)).toEqual(['name']);
        expect(await stored(email)).toEqual(before);
      });

      it('all invalid at once: every field is reported', async () => {
        const { cookie } = await loginFresh();
        const res = await patch(cookie, { name: '', phone: '12', preferredCurrency: '1' }).expect(400);
        expect(fieldsOf(res).sort()).toEqual(['name', 'phone', 'preferredCurrency']);
      });
    });

    describe('currency', () => {
      it.each(['ZZZ', 'XXX', 'ABC'])('a well-formed code outside the supported list (%s) is a field-level 400', async (code) => {
        const { cookie } = await loginFresh();
        const res = await patch(cookie, { preferredCurrency: code }).expect(400);
        expect(fieldsOf(res)).toEqual(['preferredCurrency']);
      });

      it.each(['US', 'EURO', '123', '', null, 5])('a malformed code (%p) is a field-level 400', async (code) => {
        const { cookie } = await loginFresh();
        const res = await patch(cookie, { preferredCurrency: code }).expect(400);
        expect(fieldsOf(res)).toContain('preferredCurrency');
      });

      it('every supported code is accepted', async () => {
        const { cookie } = await loginFresh();
        for (const code of ['USD', 'EUR', 'EGP', 'JPY']) {
          await patch(cookie, { preferredCurrency: code }).expect(200);
        }
      });
    });

    describe('name and phone rules', () => {
      it('name longer than 100 characters is a 400', async () => {
        const { cookie } = await loginFresh();
        expect(fieldsOf(await patch(cookie, { name: 'a'.repeat(101) }).expect(400))).toEqual(['name']);
      });

      it.each(['123', '+', 'abc', '1'.repeat(16), '12-34'])('phone %p is a 400', async (phone) => {
        const { cookie } = await loginFresh();
        expect(fieldsOf(await patch(cookie, { phone }).expect(400))).toEqual(['phone']);
      });
    });

    describe('fields that cannot be changed here', () => {
      it.each([
        ['email', 'hacker@example.com'],
        ['role', 'ADMIN'],
        ['status', 'SUSPENDED'],
        ['passwordHash', 'x'],
        ['password', 'N3wPassw0rd'],
        ['airlineId', '6730a1f2c3d4e5f607182930'],
        ['hotelId', '6730a1f2c3d4e5f607182930'],
        ['id', '6730a1f2c3d4e5f607182930'],
        ['failedAttempts', 0],
        ['consentAcceptedAt', '2020-01-01T00:00:00.000Z'],
      ])('%s is rejected with 400 and nothing is saved', async (field, value) => {
        const { email, cookie } = await loginFresh();
        const before = await stored(email);
        const res = await patch(cookie, { name: 'Valid Name', [field]: value }).expect(400);
        expect(res.body.statusCode).toBe(400);
        expect(await stored(email)).toEqual(before);
      });
    });

    describe('empty or odd bodies', () => {
      it('an empty object is a 400 and nothing is saved', async () => {
        const { email, cookie } = await loginFresh();
        const before = await stored(email);
        await patch(cookie, {}).expect(400);
        expect(await stored(email)).toEqual(before);
      });

      it.each([[[]], ['text']])('a non-object body (%p) is a 400', async (body) => {
        const { cookie } = await loginFresh();
        await http().patch('/api/users/me').set('Cookie', cookie).send(body as never).expect(400);
      });
    });

    it('a user can only change their own profile: another user is untouched', async () => {
      const a = await loginFresh();
      const b = await loginFresh();
      await patch(a.cookie, { name: 'Only A', preferredCurrency: 'JPY' }).expect(200);
      expect(await stored(b.email)).toMatchObject({ name: 'Ali Hassan', preferredCurrency: 'USD' });
      expect((await get(b.cookie).expect(200)).body.name).toBe('Ali Hassan');
    });

    it('role, status and email stay exactly as they were after a successful edit', async () => {
      const { email, cookie } = await loginFresh();
      await patch(cookie, { name: 'New', phone: '+201001234567', preferredCurrency: 'EUR' }).expect(200);
      expect(await stored(email)).toMatchObject({ email, role: 'USER', status: 'ACTIVE' });
    });

    it('the edited password hash is untouched (login still works with the old password)', async () => {
      const { email, cookie } = await loginFresh();
      await patch(cookie, { name: 'New' }).expect(200);
      await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    });

    it('a SUSPENDED account can no longer edit (guard rejects it)', async () => {
      const { email, cookie } = await loginFresh();
      await users().updateOne({ email }, { $set: { status: 'SUSPENDED' } });
      await patch(cookie, { name: 'Sneaky' }).expect(401);
      expect((await stored(email))?.name).toBe('Ali Hassan');
    });
  });

  it('Swagger documents GET and PATCH /api/users/me with cookie auth, 200, 400 and 401', async () => {
    const res = await http().get('/api/docs-json').expect(200);
    const path = res.body.paths['/api/users/me'];
    expect(Object.keys(path).sort()).toEqual(['get', 'patch']);
    expect(Object.keys(path.get.responses)).toEqual(expect.arrayContaining(['200', '401']));
    expect(Object.keys(path.patch.responses)).toEqual(expect.arrayContaining(['200', '400', '401']));
    expect(path.get.security).toBeDefined();
    expect(path.patch.security).toBeDefined();
  });
});
