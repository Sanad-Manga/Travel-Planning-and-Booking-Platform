import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AUTH_RATE_LIMIT_CONFIG } from '../src/auth/auth-rate-limit';
import { AuthModule } from '../src/auth/auth.module';
import { PasswordResetService } from '../src/auth/password-reset.service';
import configuration from '../src/config/configuration';
import { EMAIL_SENDER } from '../src/email/email-sender';
import { FakeEmailSender } from '../src/email/fake-email-sender';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

const GENERIC = { message: 'If the email is registered, a reset link has been sent.' };
const NEW = 'N3wPassw0rd';

/** ACC-07 review: per-email cooldown and per-IP limits on forgot-password / reset-password. */
describe('forgot-password rate limiting (e2e)', () => {
  let mongo: MongoMemoryServer;
  const sender = new FakeEmailSender();
  let n = 0;

  async function boot(limit: number): Promise<{ app: INestApplication; connection: Connection; resets: PasswordResetService }> {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }), MongooseModule.forRoot(mongo.getUri(), { dbName: `rl${++n}` }), AuthModule],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(sender)
      .overrideProvider(AUTH_RATE_LIMIT_CONFIG)
      .useValue({ limit, windowMs: 15 * 60_000 })
      .compile();
    const app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    const connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();
    await connection.model('PasswordResetToken').init();
    return { app, connection, resets: app.get(PasswordResetService) };
  }

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
  }, 180_000);
  afterAll(() => mongo.stop());
  beforeEach(() => {
    sender.sent.length = 0;
  });

  const tokenFrom = (message: { text: string }): string => new URL(/https?:\/\/\S+/.exec(message.text)![0]).searchParams.get('token')!;

  describe('per-email cooldown', () => {
    let app: INestApplication;
    let connection: Connection;
    let resets: PasswordResetService;
    const http = () => request(app.getHttpServer());
    const register = async (): Promise<string> => {
      const email = `cd${++n}@example.com`;
      await http().post('/api/auth/register').send({ name: 'Ali', email, password: 'Passw0rdOK', acceptTerms: true }).expect(201);
      sender.sent.length = 0; // drop the ACC-02-free registration noise, if any
      return email;
    };
    const forgot = async (email: string) => {
      const res = await http().post('/api/auth/forgot-password').send({ email });
      await resets.whenIdle();
      return res;
    };
    // ACC-02 registration also emails a verification link; only the reset email is counted here.
    const sentTo = (email: string) => sender.sent.filter((m) => m.to === email && m.subject === 'Reset your password');

    beforeAll(async () => {
      ({ app, connection, resets } = await boot(10_000));
    }, 120_000);
    afterAll(() => app.close());

    it('a second request inside 60 seconds sends no email, returns the identical 200, and the first link still works', async () => {
      const email = await register();
      const first = await forgot(email);
      const second = await forgot(email);
      expect(second.status).toBe(first.status);
      expect(second.body).toEqual(GENERIC);
      expect(second.body).toEqual(first.body);
      expect(sentTo(email)).toHaveLength(1);
      await http().post('/api/auth/reset-password').send({ token: tokenFrom(sentTo(email)[0]), newPassword: NEW }).expect(204);
    });

    it('known and unknown emails stay indistinguishable, also inside the cooldown', async () => {
      const email = await register();
      await forgot(email);
      const known = await forgot(email); // cooldown
      const unknown = await forgot('nobody@example.com');
      expect(known.status).toBe(unknown.status);
      expect(known.body).toEqual(unknown.body);
      expect(known.status).toBe(200);
    });

    it('after the cooldown a new request works and invalidates the old link', async () => {
      const email = await register();
      await forgot(email);
      const oldToken = tokenFrom(sentTo(email)[0]);
      const user = await connection.collection('users').findOne({ email });
      await connection.collection('passwordResetTokens').updateOne({ userId: user!._id }, { $set: { requestedAt: new Date(Date.now() - 61_000) } });
      await forgot(email);
      expect(sentTo(email)).toHaveLength(2);
      await http().post('/api/auth/reset-password').send({ token: oldToken, newPassword: NEW }).expect(400);
      await http().post('/api/auth/reset-password').send({ token: tokenFrom(sentTo(email)[1]), newPassword: NEW }).expect(204);
    });

    it('a row written before the cooldown existed (no requestedAt) does not block a new request', async () => {
      const email = await register();
      await forgot(email);
      const user = await connection.collection('users').findOne({ email });
      await connection.collection('passwordResetTokens').updateOne({ userId: user!._id }, { $unset: { requestedAt: 1 } });
      await forgot(email);
      expect(sentTo(email)).toHaveLength(2);
    });

    it('two parallel requests send exactly one email', async () => {
      const email = await register();
      const results = await Promise.all([forgot(email), forgot(email)]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(sentTo(email)).toHaveLength(1);
      expect(await connection.collection('passwordResetTokens').countDocuments({ userId: (await connection.collection('users').findOne({ email }))!._id })).toBe(1);
    });
  });

  describe('per-IP limit', () => {
    let app: INestApplication;
    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      ({ app } = await boot(3));
    }, 120_000);
    afterAll(() => app.close());

    it('the request over the limit gets 429 in the standard error shape with Retry-After', async () => {
      for (let i = 0; i < 3; i++) await http().post('/api/auth/forgot-password').send({ email: 'a@example.com' }).expect(200);
      const res = await http().post('/api/auth/forgot-password').send({ email: 'a@example.com' }).expect(429);
      expect(res.body).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        message: expect.any(String),
        path: '/api/auth/forgot-password',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
      });
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(900);
    });

    it('the 429 does not depend on the email (a different email from the same IP is limited too)', async () => {
      await http().post('/api/auth/forgot-password').send({ email: 'someone-else@example.com' }).expect(429);
    });

    it('reset-password has its own counter and gets 429 after the limit', async () => {
      for (let i = 0; i < 3; i++) await http().post('/api/auth/reset-password').send({ token: 'x', newPassword: NEW }).expect(400);
      const res = await http().post('/api/auth/reset-password').send({ token: 'x', newPassword: NEW }).expect(429);
      expect(res.body.statusCode).toBe(429);
      expect(res.body.path).toBe('/api/auth/reset-password');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('other routes are not limited', async () => {
      for (let i = 0; i < 5; i++) await http().post('/api/auth/login').send({ email: 'a@example.com', password: 'Passw0rdOK' }).expect(401);
    });
  });
});
