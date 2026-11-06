import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { Role } from '../src/common';
import { setupApp, setupSwagger } from '../src/setup-app';
import { User } from '../src/users/schemas/user.schema';
import { AuditService } from '../src/audit/audit.service';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

jest.setTimeout(120000);

describe('GEN-07 real AppModule registration (disposable MongoDB)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let cookie: string;
  const secret = 'gen07-root-fixture-access-0123456789abcdef';
  const keys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({
      instance: { dbName: 'gen07_root_disposable' },
    });
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: 'gen07-root-fixture-refresh-0123456789abcdef',
      COOKIE_SECURE: 'false',
    });
    // Keep the production module graph, but never read a developer's .env.
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const configSpy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        configure({ ...options, ignoreEnvFile: true }),
      );
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    configSpy.mockRestore();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    setupApp(app);
    setupSwagger(app);
    await app.listen(0, '127.0.0.1');
    const users = app
      .get<Connection>(getConnectionToken())
      .model<User>(User.name);
    const user = await users.create({
      name: 'Root Audit Fixture',
      email: 'audit-root@example.test',
      passwordHash: 'non-login-test-hash',
      consentAcceptedAt: new Date(),
      role: Role.ADMIN,
    });
    cookie = `access_token=${new JwtService().sign({ sub: user._id.toString(), role: Role.ADMIN }, { secret, expiresIn: '5m' })}`;
    await app
      .get(AuditService)
      .log({
        actorId: user._id.toString(),
        action: 'MODERATION_RECORDED',
        targetType: 'Airport',
        targetId: 'CAI',
        details: { reason: 'Synthetic root integration fixture' },
      });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await mongo?.stop();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('serves the registered endpoint with persistent records and real global authentication', async () => {
    await request(app.getHttpServer()).get('/api/admin/audit-logs').expect(401);
    const response = await request(app.getHttpServer())
      .get('/api/admin/audit-logs')
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
      items: [
        expect.objectContaining({
          action: 'MODERATION_RECORDED',
          targetId: 'CAI',
        }),
      ],
    });
    expect(response.body.items[0]).not.toHaveProperty('_id');
  });

  it('includes the registered audit endpoint in the real application Swagger document', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(
      response.body.paths['/api/admin/audit-logs'].get.responses,
    ).toHaveProperty('403');
    expect(
      response.body.paths['/api/admin/audit-logs'].get.security,
    ).toContainEqual({ cookie: [] });
  });
});
