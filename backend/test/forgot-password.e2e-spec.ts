import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { compare } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AUTH_RATE_LIMIT_CONFIG } from '../src/auth/auth-rate-limit';
import { AuthModule } from '../src/auth/auth.module';
import { PasswordResetService } from '../src/auth/password-reset.service';
import configuration from '../src/config/configuration';
import { EMAIL_SENDER } from '../src/email/email-sender';
import { FakeEmailSender } from '../src/email/fake-email-sender';
import { buildSwaggerDocument, setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

const OLD = 'Passw0rdOK';
const NEW = 'N3wPassw0rd';
const GENERIC = { message: 'If the email is registered, a reset link has been sent.' };

const setCookies = (res: request.Response): string[] => (res.headers['set-cookie'] as unknown as string[]) ?? [];
const cookieOf = (res: request.Response, name: string): string => setCookies(res).find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? '';

// ACC-07 against a real (in-memory, disposable) MongoDB, with the email sender replaced by a recording fake.
describe('forgot-password / reset-password (e2e)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let connection: Connection;
  let resets: PasswordResetService;
  const sender = new FakeEmailSender();
  let n = 0;

  const http = () => request(app.getHttpServer());
  const users = () => connection.collection('users');
  const tokenRows = () => connection.collection('passwordResetTokens');

  async function register(): Promise<string> {
    const email = `fp${++n}@example.com`;
    await http().post('/api/auth/register').send({ name: 'Ali', email, password: OLD, acceptTerms: true }).expect(201);
    return email;
  }
  const login = (email: string, password: string) => http().post('/api/auth/login').send({ email, password });
  const forgot = async (email: string) => {
    const res = await http().post('/api/auth/forgot-password').send({ email });
    await resets.whenIdle(); // the email is sent after the response
    return res;
  };
  // The 60 second per-email cooldown would swallow a second request; move the stored time back to simulate waiting.
  const endCooldown = (email: string) =>
    users()
      .findOne({ email })
      .then((u) => tokenRows().updateOne({ userId: u!._id }, { $set: { requestedAt: new Date(Date.now() - 61_000) } }));
  const reset = (token: string, newPassword: string) => http().post('/api/auth/reset-password').send({ token, newPassword });
  const tokenFrom = (message: { text: string }): string => new URL(/https?:\/\/\S+/.exec(message.text)![0]).searchParams.get('token')!;
  // ACC-02 registration also emails a verification link; these tests are about the reset email only.
  const resetMails = () => sender.sent.filter((m) => m.subject === 'Reset your password');
  const lastTokenFor = (email: string): string => tokenFrom([...resetMails()].reverse().find((m) => m.to === email)!);
  const sentTo = (email: string) => resetMails().filter((m) => m.to === email);
  const fieldsOf = (res: request.Response): string[] => (res.body.details ?? []).map((d: { field: string }) => d.field);

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryServer.create();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
      ],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(sender)
      // This spec sends far more than 10 requests from one IP; the limiter itself is tested in forgot-password-rate-limit.
      .overrideProvider(AUTH_RATE_LIMIT_CONFIG)
      .useValue({ limit: 10_000, windowMs: 60_000 })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    resets = app.get(PasswordResetService);
    await connection.model('User').init();
    await connection.model('PasswordResetToken').init(); // the unique and TTL indexes must exist before the tests
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  beforeEach(() => {
    sender.sent.length = 0;
    sender.failNextSendOnce = false;
  });

  describe('POST /api/auth/forgot-password', () => {
    it('known, unknown, suspended and deactivated emails get an identical status and body', async () => {
      const known = await register();
      const suspended = await register();
      const deactivated = await register();
      await users().updateOne({ email: suspended }, { $set: { status: 'SUSPENDED' } });
      await users().updateOne({ email: deactivated }, { $set: { status: 'DEACTIVATED' } });

      const responses = [];
      for (const email of [known, 'nobody@example.com', suspended, deactivated]) responses.push(await forgot(email));

      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual(GENERIC);
      }
      expect(responses.map((r) => JSON.stringify(r.body))).toEqual(new Array(4).fill(JSON.stringify(GENERIC)));
      // Only the ACTIVE account got an email.
      expect(resetMails().map((m) => m.to)).toEqual([known]);
      expect(await tokenRows().countDocuments()).toBe(await tokenRows().countDocuments({ userId: (await users().findOne({ email: known }))!._id }));
    });

    it('the email carries a link with the token, mentions 30 minutes, and the database holds only its SHA-256 hash', async () => {
      const email = await register();
      await forgot(email);

      const [message] = sentTo(email);
      expect(message.subject).toBeTruthy();
      expect(message.text).toContain('30 minutes');
      expect(message.html).toContain('30 minutes');
      expect(message.text).toMatch(/^.*http:\/\/localhost:3000\/reset-password\?token=[A-Za-z0-9_-]{43}$/m);

      const token = tokenFrom(message);
      const user = await users().findOne({ email });
      const row = await tokenRows().findOne({ userId: user!._id });
      expect(row!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(token);
      const lifetime = row!.expiresAt.getTime() - row!.createdAt.getTime();
      expect(Math.abs(lifetime - 30 * 60_000)).toBeLessThan(5_000);
    });

    it('a failed email send does not change the response', async () => {
      const email = await register();
      // The ACC-02 verification email is sent in the background after registration; let it go out first so it cannot use up the one-shot failure.
      for (let i = 0; i < 100 && !sender.sent.some((m) => m.to === email); i++) await new Promise((r) => setTimeout(r, 20));
      sender.failNextSendOnce = true;
      const res = await forgot(email);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(GENERIC);
      expect(sentTo(email)).toHaveLength(0);
    });

    it('is case- and whitespace-insensitive like login', async () => {
      const email = await register();
      await forgot(`  ${email.toUpperCase()} `);
      expect(sentTo(email)).toHaveLength(1);
    });

    it.each([
      ['malformed', { email: 'not-an-email' }],
      ['missing', {}],
      ['unknown field', { email: 'a@example.com', extra: 1 }],
    ])('%s body is a field-level 400', async (_label, body) => {
      const res = await http().post('/api/auth/forgot-password').send(body).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed', path: '/api/auth/forgot-password' });
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it('two parallel requests leave exactly one live token, and only the surviving link works', async () => {
      const email = await register();
      await Promise.all([forgot(email), forgot(email)]);
      expect(sentTo(email)).toHaveLength(1); // the cooldown lets exactly one of two parallel requests through

      const user = await users().findOne({ email });
      expect(await tokenRows().countDocuments({ userId: user!._id })).toBe(1);
      const works = [];
      for (const message of sentTo(email)) works.push((await reset(tokenFrom(message), NEW)).status);
      expect(works.filter((s) => s === 204)).toHaveLength(1);
      expect(works.filter((s) => s === 400)).toHaveLength(sentTo(email).length - 1);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('the link works once: the first use is 204, the second is 400', async () => {
      const email = await register();
      await forgot(email);
      const token = lastTokenFor(email);

      await reset(token, NEW).expect(204);
      const second = await reset(token, 'An0therPass1').expect(400);
      expect(second.body.details).toEqual([{ field: 'token', message: 'token is invalid or has expired' }]);
      expect((await login(email, NEW)).status).toBe(200); // the second attempt changed nothing
    });

    it('changes the password: the old one fails, the new one works, stored as a salted bcrypt hash; no cookie is set', async () => {
      const email = await register();
      await forgot(email);
      const res = await reset(lastTokenFor(email), NEW).expect(204);
      expect(setCookies(res)).toEqual([]);
      expect(res.text).toBe('');

      expect((await login(email, OLD)).status).toBe(401);
      expect((await login(email, NEW)).status).toBe(200);
      const doc = await users().findOne({ email });
      expect(doc!.passwordHash).toMatch(/^\$2[aby]\$10\$/);
      expect(doc!.passwordHash).not.toContain(NEW);
      await expect(compare(NEW, doc!.passwordHash)).resolves.toBe(true);
    });

    it('a second forgot-password invalidates the first link; the newest works', async () => {
      const email = await register();
      await forgot(email);
      const first = lastTokenFor(email);
      await endCooldown(email);
      await forgot(email);
      const second = lastTokenFor(email);
      expect(second).not.toBe(first);

      const stale = await reset(first, NEW).expect(400);
      expect(stale.body.details).toEqual([{ field: 'token', message: 'token is invalid or has expired' }]);
      await reset(second, NEW).expect(204);
    });

    it('a new request after a used link works again (the row is renewed, usedAt cleared)', async () => {
      const email = await register();
      await forgot(email);
      await reset(lastTokenFor(email), NEW).expect(204);
      await endCooldown(email);
      await forgot(email);
      await reset(lastTokenFor(email), 'An0therPass1').expect(204);
      expect((await login(email, 'An0therPass1')).status).toBe(200);
    });

    it('an expired token is 400 with the same error and the password stays', async () => {
      const email = await register();
      await forgot(email);
      const token = lastTokenFor(email);
      await tokenRows().updateOne({ userId: (await users().findOne({ email }))!._id }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });

      const res = await reset(token, NEW).expect(400);
      expect(res.body.details).toEqual([{ field: 'token', message: 'token is invalid or has expired' }]);
      expect((await login(email, OLD)).status).toBe(200);
    });

    it('unknown, malformed and over-long tokens all give the same 400 on token', async () => {
      const bodies = [];
      for (const token of ['does-not-exist', 'x'.repeat(43), 'x'.repeat(5000)]) {
        const res = await reset(token, NEW).expect(400);
        bodies.push(res.body.details);
      }
      for (const details of bodies) expect(details).toEqual([{ field: 'token', message: 'token is invalid or has expired' }]);
    });

    it('a weak password is a field-level 400 on newPassword and does NOT consume the token', async () => {
      const email = await register();
      await forgot(email);
      const token = lastTokenFor(email);

      for (const weak of ['ab1', 'abcdefghij', '1234567890']) {
        const res = await reset(token, weak).expect(400);
        expect(fieldsOf(res)).toEqual(['newPassword']);
      }
      await reset(token, NEW).expect(204); // the same token still works
    });

    it('validates the DTO before the token: a weak password with a bad token is a newPassword error', async () => {
      const res = await reset('does-not-exist', 'ab1').expect(400);
      expect(fieldsOf(res)).toEqual(['newPassword']);
    });

    it('kills existing sessions: the old refresh cookie and the old access cookie get 401', async () => {
      const email = await register();
      const session = await login(email, OLD).expect(200);
      const access = cookieOf(session, 'access_token');
      const refresh = cookieOf(session, 'refresh_token');
      await http().get('/api/auth/me').set('Cookie', access).expect(200);

      await forgot(email);
      await reset(lastTokenFor(email), NEW).expect(204);

      await http().post('/api/auth/refresh').set('Cookie', refresh).expect(401);
      await http().get('/api/auth/me').set('Cookie', access).expect(401);
    });

    it('clears the login lockout and the failed-attempts counter', async () => {
      const email = await register();
      for (let i = 0; i < 5; i++) await login(email, 'WrongPass1');
      expect((await login(email, OLD)).status).toBe(423); // locked even for the right password
      expect((await users().findOne({ email }))!.lockedUntil).toBeTruthy();

      await forgot(email); // a locked ACTIVE account still gets the link
      await reset(lastTokenFor(email), NEW).expect(204);

      const doc = await users().findOne({ email });
      expect(doc!.failedAttempts).toBe(0);
      expect(doc!.lockedUntil).toBeUndefined();
      expect((await login(email, NEW)).status).toBe(200);
    });

    it('clears a pending admin temporary-password state', async () => {
      const email = await register();
      await users().updateOne(
        { email },
        { $set: { mustChangePassword: true, temporaryPasswordConsumed: false, temporaryPasswordExpiresAt: new Date(Date.now() + 3_600_000) } },
      );
      await forgot(email);
      await reset(lastTokenFor(email), NEW).expect(204);

      const doc = await users().findOne({ email });
      expect(doc!.mustChangePassword).toBe(false);
      expect(doc!.temporaryPasswordConsumed).toBeUndefined();
      expect(doc!.temporaryPasswordExpiresAt).toBeUndefined();
      const session = await login(email, NEW).expect(200);
      await http().get('/api/auth/me').set('Cookie', cookieOf(session, 'access_token')).expect(200);
    });

    it('a user suspended after the link was sent gets the same 400 and the token is not consumed', async () => {
      const email = await register();
      await forgot(email);
      const token = lastTokenFor(email);
      await users().updateOne({ email }, { $set: { status: 'SUSPENDED' } });

      const res = await reset(token, NEW).expect(400);
      expect(res.body.details).toEqual([{ field: 'token', message: 'token is invalid or has expired' }]);
      const row = await tokenRows().findOne({ userId: (await users().findOne({ email }))!._id });
      expect(row!.usedAt).toBeUndefined();
      await users().updateOne({ email }, { $set: { status: 'ACTIVE' } });
      await reset(token, NEW).expect(204);
    });

    it('5 parallel resets with the same token: exactly one 204 and four 400', async () => {
      const email = await register();
      await forgot(email);
      const token = lastTokenFor(email);

      const statuses = (await Promise.all(Array.from({ length: 5 }, (_, i) => reset(token, `Parallel${i}pass`)))).map((r) => r.status);
      expect(statuses.filter((s) => s === 204)).toHaveLength(1);
      expect(statuses.filter((s) => s === 400)).toHaveLength(4);
      expect((await users().findOne({ email }))!.tokenVersion).toBe(1); // bumped once
    });
  });

  describe('Swagger', () => {
    it('documents both routes with their responses', () => {
      const { paths } = buildSwaggerDocument(app);
      const responses = (path: string) => Object.keys((paths[path]?.post?.responses ?? {}) as Record<string, unknown>);
      expect(responses('/api/auth/forgot-password')).toEqual(expect.arrayContaining(['200', '400']));
      expect(responses('/api/auth/reset-password')).toEqual(expect.arrayContaining(['204', '400']));
    });
  });
});
