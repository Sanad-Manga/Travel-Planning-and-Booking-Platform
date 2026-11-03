import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthTestApp, createAuthTestApp } from './helpers/auth-test-app';

// GEN-13: rules are enforced by the backend whatever the frontend sends.
// Field-level errors and the unknown "role" field on register are already covered in register.e2e-spec.ts.
describe('backend-enforced validation and password hashing (e2e)', () => {
  let testApp: AuthTestApp;
  let app: INestApplication;

  const PASSWORD = 'SamePassw0rd';
  const post = (path: string, body: unknown) => request(app.getHttpServer()).post(path).send(body as object);
  const fieldsOf = (res: request.Response): string[] => res.body.details.map((d: { field: string }) => d.field);

  beforeAll(async () => {
    testApp = await createAuthTestApp();
    app = testApp.app;
  }, 180_000);

  afterAll(() => testApp.close());

  it('rejects values of the wrong type with field-level errors (not just missing ones)', async () => {
    const res = await post('/api/auth/register', { name: 123, email: ['a@b.com'], password: 12345678, acceptTerms: 'true' }).expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
    expect(fieldsOf(res)).toEqual(expect.arrayContaining(['name', 'email', 'password', 'acceptTerms']));
  });

  it('rejects unknown fields on login too (the pattern is global, not per endpoint)', async () => {
    const res = await post('/api/auth/login', { email: 'a@b.com', password: 'x', isAdmin: true }).expect(400);
    expect(fieldsOf(res)).toEqual(['isAdmin']);
  });

  it('rejects an empty body with an error for every required field', async () => {
    const res = await post('/api/auth/register', {}).expect(400);
    expect(fieldsOf(res)).toEqual(expect.arrayContaining(['name', 'email', 'password', 'acceptTerms']));
  });

  // bcrypt only uses the first 72 BYTES, so the limit is counted in UTF-8 bytes, not characters.
  describe('password length limit is 72 bytes', () => {
    const register = (email: string, password: string) =>
      post('/api/auth/register', { name: 'Ali', email, password, acceptTerms: true });

    it('accepts exactly 72 ASCII characters (72 bytes)', async () => {
      await register('bytes72@example.com', 'a1'.repeat(36)).expect(201);
    });

    it('rejects 73 ASCII characters with a field-level error', async () => {
      const res = await register('bytes73@example.com', 'a1'.repeat(36) + 'b').expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
      expect(res.body.details).toEqual([{ field: 'password', message: expect.stringContaining('72 bytes') }]);
    });

    it('rejects 40 Arabic letters + a Latin letter and digit (42 characters but 82 bytes)', async () => {
      const res = await register('arabic-long@example.com', 'ع'.repeat(40) + 'a1').expect(400);
      expect(fieldsOf(res)).toEqual(['password']);
    });

    it('accepts a short password with a few Arabic characters (under 72 bytes)', async () => {
      await register('arabic-short@example.com', 'كلمةسر' + 'Pass1234').expect(201);
    });
  });

  it('two users with the same password get different bcrypt hashes, and neither is the plaintext', async () => {
    for (const email of ['first@example.com', 'second@example.com']) {
      await post('/api/auth/register', { name: 'User', email, password: PASSWORD, acceptTerms: true }).expect(201);
    }
    const users = testApp.connection.collection('users');
    const first = await users.findOne({ email: 'first@example.com' });
    const second = await users.findOne({ email: 'second@example.com' });

    expect(first?.passwordHash).not.toBe(second?.passwordHash);
    for (const hash of [first?.passwordHash, second?.passwordHash]) {
      expect(hash).toMatch(/^\$2[aby]\$10\$/);
      expect(hash).not.toContain(PASSWORD);
    }
  });

  it('both users can still log in with the shared password', async () => {
    for (const email of ['first@example.com', 'second@example.com']) {
      await post('/api/auth/login', { email, password: PASSWORD }).expect(200);
    }
  });
});
