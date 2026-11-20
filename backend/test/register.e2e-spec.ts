import { INestApplication } from '@nestjs/common';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AuthTestApp, createAuthTestApp } from './helpers/auth-test-app';

describe('POST /api/auth/register (e2e)', () => {
  let testApp: AuthTestApp;
  let app: INestApplication;
  let connection: Connection;

  const valid = { name: 'Ali Hassan', email: 'ali@example.com', password: 'Passw0rdOK', acceptTerms: true };
  const register = (body: object) => request(app.getHttpServer()).post('/api/auth/register').send(body);
  const fieldsOf = (res: request.Response): string[] => res.body.details.map((d: { field: string }) => d.field);

  beforeAll(async () => {
    testApp = await createAuthTestApp();
    ({ app, connection } = testApp);
  }, 180_000); // the very first run downloads the in-memory MongoDB binary

  afterAll(() => testApp.close());

  it('registers a user without being logged in: 201, role USER, no hash, no cookies', async () => {
    const res = await register(valid).expect(201);
    expect(res.body).toMatchObject({ name: 'Ali Hassan', email: 'ali@example.com', role: 'USER', status: 'ACTIVE' });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body._id).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|Passw0rdOK/);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('stores only a bcrypt hash in the database', async () => {
    const doc = await connection.collection('users').findOne({ email: 'ali@example.com' });
    expect(doc?.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(doc?.passwordHash).not.toContain('Passw0rdOK');
    expect(doc?.consentAcceptedAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate email (case-insensitive) with 409 and a field-level detail', async () => {
    const res = await register({ ...valid, email: ' ALI@Example.com ' }).expect(409);
    expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict', path: '/api/auth/register' });
    expect(res.body.details).toEqual([{ field: 'email', message: expect.any(String) }]);
  });

  it('rejects an invalid email with 400', async () => {
    const res = await register({ ...valid, email: 'not-an-email' }).expect(400);
    expect(res.body.message).toBe('Validation failed');
    expect(fieldsOf(res)).toEqual(['email']);
  });

  it.each([
    ['too short', 'Ab1'],
    ['no digit', 'OnlyLettersHere'],
    ['no letter', '1234567890'],
  ])('rejects a weak password (%s) with 400', async (_label, password) => {
    const res = await register({ ...valid, email: 'weak@example.com', password }).expect(400);
    expect(fieldsOf(res)).toContain('password');
  });

  it.each([
    ['missing', undefined],
    ['false', false],
  ])('rejects consent that is %s with 400', async (_label, acceptTerms) => {
    const res = await register({ ...valid, email: 'consent@example.com', acceptTerms }).expect(400);
    expect(fieldsOf(res)).toEqual(['acceptTerms']);
  });

  it('rejects a role field (cannot self-register as admin) with 400', async () => {
    const res = await register({ ...valid, email: 'admin@example.com', role: 'ADMIN' }).expect(400);
    expect(fieldsOf(res)).toEqual(['role']);
  });

  it('reports several field errors at once', async () => {
    const res = await register({ name: '', email: 'x', password: 'a' }).expect(400);
    expect(fieldsOf(res)).toEqual(expect.arrayContaining(['name', 'email', 'password', 'acceptTerms']));
  });
});
