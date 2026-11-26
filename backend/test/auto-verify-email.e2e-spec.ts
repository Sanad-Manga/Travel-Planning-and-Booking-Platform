import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

/**
 * ACC-02 dev/demo flag (G12): AUTO_VERIFY_EMAIL=true lets a freshly registered user book without an inbox.
 * Runs against the real AppModule; the guard runs before body validation, so an empty body proves 403 vs not-403.
 */
describe('AUTO_VERIFY_EMAIL dev flag (ACC-02, whole app)', () => {
  let mongo: MongoMemoryServer;
  const originalFlag = process.env.AUTO_VERIFY_EMAIL;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
  }, 180_000);

  afterAll(async () => {
    await mongo?.stop();
    if (originalFlag === undefined) delete process.env.AUTO_VERIFY_EMAIL;
    else process.env.AUTO_VERIFY_EMAIL = originalFlag;
  });

  async function bootApp(flag?: string): Promise<{ app: INestApplication; connection: Connection }> {
    if (flag === undefined) delete process.env.AUTO_VERIFY_EMAIL;
    else process.env.AUTO_VERIFY_EMAIL = flag;
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    // The config factory reads process.env each time a module is compiled, so one import serves both boots.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    return { app, connection: app.get<Connection>(getConnectionToken()) };
  }

  async function registerAndBook(app: INestApplication, email: string) {
    const http = () => request(app.getHttpServer());
    const credentials = { name: 'Ali Hassan', email, password: 'Passw0rdOK', acceptTerms: true };
    await http().post('/api/auth/register').send(credentials).expect(201);
    const login = await http().post('/api/auth/login').send({ email, password: credentials.password }).expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    return http().post('/api/flight-bookings').set('Cookie', cookie).send({});
  }

  it('flag "true": a newly registered user is not blocked by the verified-email guard (400 validation, not 403)', async () => {
    const { app, connection } = await bootApp('true');
    try {
      const res = await registerAndBook(app, 'demo-on@example.com');
      expect(res.status).not.toBe(403);
      expect(res.status).toBe(400);
      const stored = await connection.collection('users').findOne({ email: 'demo-on@example.com' });
      expect(stored?.emailVerified).toBe(true);
    } finally {
      await app.close();
    }
  }, 60_000);

  it('flag unset: the same flow still gets 403 "Verify your email before booking"', async () => {
    const { app } = await bootApp(undefined);
    try {
      const res = await registerAndBook(app, 'demo-off@example.com');
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Verify your email before booking');
    } finally {
      await app.close();
    }
  }, 60_000);
});
