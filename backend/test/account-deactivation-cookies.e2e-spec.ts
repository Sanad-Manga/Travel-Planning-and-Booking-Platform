import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';
import { expectSameCookieIdentity, recordCookieFlow } from './helpers/cookie-compare';

// ACC-12 with the production-like setting: the REAL AppModule (global ConfigModule, configuration.ts) with
// COOKIE_SECURE=true. The COOKIE_SECURE=false twin of this check lives in account-deactivation.e2e-spec.ts.
// One jest file = one module registry, so the two settings need two files (configuration.ts reads the env once).
describe('DELETE /api/users/me cookies with COOKIE_SECURE=true, real AppModule (ACC-12, e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    // Set BEFORE AppModule is imported so nothing from backend/.env (e.g. the shared Atlas URI) can win.
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'true';
    expect(process.env.MONGODB_URI).toMatch(/^mongodb:\/\/127\.0\.0\.1:/);

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('deactivation clears BOTH cookies with the same Path, HttpOnly, SameSite and Secure as login sets and logout clears', async () => {
    const flow = await recordCookieFlow(app, 'secure-cookies@example.com');
    expectSameCookieIdentity(flow, true);
  });
});
