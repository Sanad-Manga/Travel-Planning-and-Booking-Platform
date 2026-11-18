import { Controller, INestApplication, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { RequireVerifiedEmail } from '../src/auth';
import { AuthModule } from '../src/auth/auth.module';
import configuration from '../src/config/configuration';
import { EMAIL_SENDER } from '../src/email/email-sender';
import { FakeEmailSender } from '../src/email/fake-email-sender';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

// Test-only stand-in for a booking-creation route (the real routes are not changed by ACC-02).
@Controller('test-bookings')
class TestBookingController {
  @Post()
  @RequireVerifiedEmail()
  create(): { ok: boolean } {
    return { ok: true };
  }
}

describe('Email verification before booking (ACC-02, e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;
  const sender = new FakeEmailSender();

  const http = () => request(app.getHttpServer());
  const PASSWORD = 'Passw0rdOK';
  const credentials = (email: string) => ({ name: 'Ali Hassan', email, password: PASSWORD, acceptTerms: true });

  /** Waits for the background send, then returns the token from the emailed link. */
  async function linkTokenFor(email: string): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const mail = [...sender.sent].reverse().find((m) => m.to === email);
      if (mail) return new URL(/https?:\/\/\S+/.exec(mail.text)![0]).searchParams.get('token')!;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('no verification email was sent');
  }

  async function loginCookie(email: string): Promise<string> {
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  }

  const register = (email: string) => http().post('/api/auth/register').send(credentials(email));

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryServer.create();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }), MongooseModule.forRoot(mongo.getUri()), AuthModule],
      controllers: [TestBookingController],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(sender)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();
    await connection.collection('emailVerificationTokens').createIndex({ userId: 1 }, { unique: true });
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  it('register stores emailVerified=false, answers 201 as before, and emails exactly one working link', async () => {
    const res = await register('a@example.com').expect(201);
    expect(res.body).toMatchObject({ email: 'a@example.com', role: 'USER', status: 'ACTIVE', emailVerified: false });
    const token = await linkTokenFor('a@example.com');
    expect(sender.sent.filter((m) => m.to === 'a@example.com')).toHaveLength(1);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = await connection.collection('emailVerificationTokens').findOne({});
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect((await connection.collection('users').findOne({ email: 'a@example.com' }))?.emailVerified).toBe(false);
  });

  it('login still works for an unverified user', async () => {
    await loginCookie('a@example.com');
  });

  it('the test-only booking route: guest 401, unverified 403 with a stable code, verified 200', async () => {
    await http().post('/api/test-bookings').expect(401);
    const cookie = await loginCookie('a@example.com');
    const blocked = await http().post('/api/test-bookings').set('Cookie', cookie).expect(403);
    expect(blocked.body).toMatchObject({
      statusCode: 403,
      message: 'Verify your email before booking',
      details: [{ field: 'emailVerified', message: 'EMAIL_NOT_VERIFIED' }],
    });

    const token = await linkTokenFor('a@example.com');
    const verified = await http().get('/api/auth/verify-email').query({ token }).expect(200);
    expect(verified.body).toEqual({ message: 'Email verified' });
    // The same session is allowed straight away: the flag is read from the database on each guarded request.
    await http().post('/api/test-bookings').set('Cookie', cookie).expect(201);
    expect((await http().get('/api/auth/me').set('Cookie', cookie).expect(200)).body.emailVerified).toBe(true);
  });

  it('a used token cannot be used again: 400 with a field-level error on token', async () => {
    const token = await linkTokenFor('a@example.com');
    const res = await http().get('/api/auth/verify-email').query({ token }).expect(400);
    expect(res.body.details).toEqual([{ field: 'token', message: 'invalid or expired verification link' }]);
  });

  it('an expired token gives 400', async () => {
    await register('exp@example.com').expect(201);
    const token = await linkTokenFor('exp@example.com');
    await connection.collection('emailVerificationTokens').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await http().get('/api/auth/verify-email').query({ token }).expect(400);
    expect(res.body.details).toEqual([{ field: 'token', message: 'invalid or expired verification link' }]);
    expect((await connection.collection('users').findOne({ email: 'exp@example.com' }))?.emailVerified).toBe(false);
  });

  it('a garbage token and a missing token give field-level 400s', async () => {
    const garbage = await http().get('/api/auth/verify-email').query({ token: 'garbage' }).expect(400);
    expect(garbage.body.details).toEqual([{ field: 'token', message: 'invalid or expired verification link' }]);
    const missing = await http().get('/api/auth/verify-email').expect(400);
    expect(missing.body.message).toBe('Validation failed');
    expect(missing.body.details.map((d: { field: string }) => d.field)).toEqual(['token']);
  });

  it('five parallel verifications with the same token: exactly one 200, the rest 400', async () => {
    await register('race@example.com').expect(201);
    const token = await linkTokenFor('race@example.com');
    const results = await Promise.all(Array.from({ length: 5 }, () => http().get('/api/auth/verify-email').query({ token })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
  });

  it.each(['SUSPENDED', 'DEACTIVATED'])('a %s user cannot verify (generic 400) and stays unverified', async (status) => {
    const email = `${status.toLowerCase()}@example.com`;
    await register(email).expect(201);
    const token = await linkTokenFor(email);
    await connection.collection('users').updateOne({ email }, { $set: { status } });
    await http().get('/api/auth/verify-email').query({ token }).expect(400);
    expect((await connection.collection('users').findOne({ email }))?.emailVerified).toBe(false);
  });

  it('a user without the emailVerified field (existing, seeded, admin-created) passes the guard', async () => {
    await register('legacy@example.com').expect(201);
    await connection.collection('users').updateOne({ email: 'legacy@example.com' }, { $unset: { emailVerified: 1 } });
    const cookie = await loginCookie('legacy@example.com');
    await http().post('/api/test-bookings').set('Cookie', cookie).expect(201);
    expect((await http().get('/api/auth/me').set('Cookie', cookie).expect(200)).body.emailVerified).toBe(true);
  });

  it('an already verified user with a fresh token gets a clean 200', async () => {
    await register('twice@example.com').expect(201);
    const token = await linkTokenFor('twice@example.com');
    await connection.collection('users').updateOne({ email: 'twice@example.com' }, { $set: { emailVerified: true } });
    const res = await http().get('/api/auth/verify-email').query({ token }).expect(200);
    expect(res.body).toEqual({ message: 'Email already verified' });
  });

  it('a failed email send does not fail registration (still 201, account created unverified)', async () => {
    sender.failNextSendOnce = true;
    const res = await register('smtpdown@example.com').expect(201);
    expect(res.body.emailVerified).toBe(false);
    expect(sender.sent.some((m) => m.to === 'smtpdown@example.com')).toBe(false);
    // Login still works.
    await loginCookie('smtpdown@example.com');
  });
});
