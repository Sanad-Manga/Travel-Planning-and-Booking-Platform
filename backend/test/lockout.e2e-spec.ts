import { INestApplication } from '@nestjs/common';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import { AuthTestApp, createAuthTestApp } from './helpers/auth-test-app';

// ACC-05 against a real (in-memory, disposable) MongoDB, so the atomic counter update is really executed.
describe('account lockout (e2e)', () => {
  let testApp: AuthTestApp;
  let app: INestApplication;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const login = (email: string, password = PASSWORD) => http().post('/api/auth/login').send({ email, password });
  const users = () => testApp.connection.collection('users');

  const insertUser = (email: string, extra: Record<string, unknown> = {}) =>
    users().insertOne({
      name: 'Seeded',
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role: 'USER',
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });

  beforeAll(async () => {
    testApp = await createAuthTestApp();
    app = testApp.app;
  });
  afterAll(() => testApp.close());
  beforeEach(() => users().deleteMany({}));

  it('4 failures stay 401, the 5th returns 423 in the shared error shape', async () => {
    await insertUser('a@example.com');
    for (let i = 0; i < 4; i++) {
      await login('a@example.com', 'WrongPass1').expect(401);
    }
    const res = await login('a@example.com', 'WrongPass1').expect(423);
    expect(res.body).toMatchObject({
      statusCode: 423,
      error: 'Locked',
      message: expect.stringMatching(/try again in 15 minutes/i),
      path: '/api/auth/login',
      timestamp: expect.any(String),
    });
    const doc = await users().findOne({ email: 'a@example.com' });
    expect(doc?.status).toBe('ACTIVE'); // lockout never touches the status field
    expect(doc?.failedAttempts).toBe(5);
  });

  it('the correct password during the lock is still 423, and no cookie is set', async () => {
    await insertUser('a@example.com', { failedAttempts: 5, lockedUntil: new Date(Date.now() + 10 * 60_000) });
    const res = await login('a@example.com').expect(423);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('the lock ends: with lockedUntil in the past the right password logs in and resets the counter', async () => {
    await insertUser('a@example.com', { failedAttempts: 5, lockedUntil: new Date(Date.now() - 1000) });
    await login('a@example.com').expect(200);
    const doc = await users().findOne({ email: 'a@example.com' });
    expect(doc?.failedAttempts).toBe(0);
    expect(doc?.lockedUntil).toBeUndefined();
  });

  it('a wrong password after an expired lock restarts the count at 1 (no instant re-lock)', async () => {
    await insertUser('a@example.com', { failedAttempts: 5, lockedUntil: new Date(Date.now() - 1000) });
    await login('a@example.com', 'WrongPass1').expect(401);
    const doc = await users().findOne({ email: 'a@example.com' });
    expect(doc?.failedAttempts).toBe(1);
    expect(doc?.lockedUntil).toBeUndefined();
  });

  it('a successful login resets the counter, so failures must be consecutive', async () => {
    await insertUser('a@example.com');
    for (let i = 0; i < 3; i++) await login('a@example.com', 'WrongPass1').expect(401);
    await login('a@example.com').expect(200);
    for (let i = 0; i < 4; i++) await login('a@example.com', 'WrongPass1').expect(401);
    await login('a@example.com').expect(200);
  });

  it('is per account: locking one user does not affect another, and unknown emails create nothing', async () => {
    await insertUser('a@example.com');
    await insertUser('b@example.com');
    for (let i = 0; i < 5; i++) await login('a@example.com', 'WrongPass1');
    await login('a@example.com').expect(423);
    await login('b@example.com', 'WrongPass1').expect(401);
    await login('b@example.com').expect(200);
    for (let i = 0; i < 6; i++) await login('nobody@example.com', 'WrongPass1').expect(401);
    expect(await users().countDocuments({ email: 'nobody@example.com' })).toBe(0);
  });

  it('parallel wrong passwords cannot slip past the limit (atomic counter)', async () => {
    await insertUser('a@example.com');
    const results = await Promise.all(Array.from({ length: 12 }, () => login('a@example.com', 'WrongPass1')));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(4); // exactly 4 attempts get through below the limit
    expect(statuses.filter((s) => s === 423).length).toBeGreaterThanOrEqual(1);
    const doc = await users().findOne({ email: 'a@example.com' });
    expect(doc?.failedAttempts).toBe(5); // never more than the limit: later attempts hit the active lock
    expect(doc?.lockedUntil).toBeInstanceOf(Date);
    await login('a@example.com').expect(423);
  });
});
