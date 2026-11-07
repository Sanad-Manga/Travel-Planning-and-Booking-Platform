import {
  Controller,
  Injectable,
  INestApplication,
  Module,
  NotFoundException,
  Param,
  Post,
  UploadedFile as FileParam,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { ExpressAdapter, FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import {
  AuthenticatedUser,
  CurrentUser,
  IMAGE_MAX_BYTES,
  Role,
  Roles,
} from '../src/common';
import { setupApp } from '../src/setup-app';
import { User } from '../src/users/schemas/user.schema';
import { UploadService, UploadsModule, UploadFile } from '../src/uploads';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';
import { UploadStorage } from '../src/uploads/upload-storage';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

/** Test-only owner endpoint. No corresponding production upload endpoint is added. */
@Injectable()
class FixtureOwner {
  actorId = '';
  constructor(readonly uploads: UploadService) {}
  async attach(actor: AuthenticatedUser, entityId: string, file: UploadFile) {
    if (actor.userId !== this.actorId || entityId !== 'owned-post')
      throw new NotFoundException('Post not found');
    return this.uploads.save(file, { kind: 'post', ownerId: entityId });
  }
}
@Controller('upload-fixture')
@Roles(Role.USER)
class FixtureController {
  constructor(private readonly owner: FixtureOwner) {}
  @Post(':id')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
    }),
  )
  save(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @FileParam() file: UploadFile,
  ) {
    return this.owner.attach(actor, id, file);
  }
}
@Module({
  imports: [UploadsModule],
  providers: [FixtureOwner],
  controllers: [FixtureController],
})
class ConsumerModule {}

jest.setTimeout(120000);
describe('GEN-08 real AppModule, exported DI, HTTP storage and authorized consumer fixture', () => {
  let app: INestApplication, mongo: MongoMemoryServer, root: string;
  let cookie: string, otherCookie: string, moderatorCookie: string;
  let image: Buffer;
  const secret = 'gen08-fixture-access-0123456789abcdef';
  const keys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'gen08-e2e-'));
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: 'gen08-fixture-refresh-0123456789abcdef',
      COOKIE_SECURE: 'false',
    });
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const spy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        configure({ ...options, ignoreEnvFile: true }),
      );
    const { AppModule } = await import('../src/app.module');
    // ServeStatic selects its loader during compile. Supply the real HTTP adapter
    // at that point, as NestFactory does in production, rather than a NoopLoader.
    const adapter = new ExpressAdapter();
    const adapterHost = new HttpAdapterHost();
    adapterHost.httpAdapter = adapter;
    const module = await Test.createTestingModule({
      imports: [AppModule, ConsumerModule],
    })
      .overrideProvider(HttpAdapterHost)
      .useValue(adapterHost)
      .overrideProvider(UPLOAD_OPTIONS)
      .useValue({
        root,
        leaseMs: 60000,
        recoveryIntervalMs: 3600000,
        recoveryBatchSize: 50,
      })
      .compile();
    spy.mockRestore();
    app = module.createNestApplication(adapter);
    app.useLogger(false);
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    const users = app
      .get<Connection>(getConnectionToken())
      .model<User>(User.name);
    const create = async (role: Role, email: string) => {
      const user = await users.create({
        name: 'Upload Fixture',
        email,
        passwordHash: 'non-login-fixture',
        role,
        consentAcceptedAt: new Date(),
      });
      const session = `access_token=${new JwtService().sign({ sub: user._id.toString(), role }, { secret, expiresIn: '5m' })}`;
      return { id: user._id.toString(), session };
    };
    const owner = await create(Role.USER, 'gen08-owner@example.test');
    cookie = owner.session;
    app.get(FixtureOwner).actorId = owner.id;
    otherCookie = (await create(Role.USER, 'gen08-other@example.test')).session;
    moderatorCookie = (
      await create(Role.AIRLINE_MODERATOR, 'gen08-mod@example.test')
    ).session;
    image = await sharp({
      create: { width: 3, height: 3, channels: 3, background: 'green' },
    })
      .png()
      .toBuffer();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const upload = (buffer: Buffer = image, mime = 'image/png') =>
    request(app.getHttpServer())
      .post('/api/upload-fixture/owned-post')
      .set('Cookie', cookie)
      .attach('image', buffer, {
        filename: '../../untrusted.png',
        contentType: mime,
      });
  it('boots production AppModule and injects the exported service into a consumer module', () => {
    expect(app.get(FixtureOwner).uploads).toBe(app.get(UploadService));
  });
  it('returns a URL that publicly serves the exact validated bytes without the API prefix', async () => {
    const res = await upload().expect(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{24}$/),
      url: expect.stringMatching(/^\/uploads\/[a-f0-9]{24}\.png$/),
    });
    expect(
      await fs.readFile(join(root, 'public', `${res.body.id}.png`)),
    ).toEqual(image);
    const imageRes = await request(app.getHttpServer())
      .get(res.body.url)
      .expect(200);
    expect(imageRes.headers['content-type']).toMatch(/^image\/png/);
    expect(imageRes.headers['x-content-type-options']).toBe('nosniff');
    expect(imageRes.body).toEqual(image);
    await app.get(UploadService).remove(res.body.id);
    await request(app.getHttpServer()).get(res.body.url).expect(404);
  });
  it('rejects a missing file and mismatched or disguised content with standard errors', async () => {
    await request(app.getHttpServer())
      .post('/api/upload-fixture/owned-post')
      .set('Cookie', cookie)
      .expect(400);
    for (const [buffer, mime] of [
      [Buffer.from('GIF89a'), 'image/gif'],
      [Buffer.from('%PDF-1.7'), 'application/pdf'],
      [image, 'image/jpeg'],
      [Buffer.from('plain text'), 'image/png'],
    ] as const) {
      const response = await upload(buffer, mime).expect(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: expect.any(String),
        path: '/api/upload-fixture/owned-post',
        timestamp: expect.any(String),
      });
    }
  });
  it('rejects an oversized multipart upload', async () => {
    await upload(Buffer.alloc(IMAGE_MAX_BYTES + 1)).expect(413);
  });
  it('uses actual authentication, roles and owner checks before invoking uploads', async () => {
    await request(app.getHttpServer())
      .post('/api/upload-fixture/owned-post')
      .attach('image', image, 'x.png')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/upload-fixture/owned-post')
      .set('Cookie', moderatorCookie)
      .attach('image', image, 'x.png')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/upload-fixture/owned-post')
      .set('Cookie', otherCookie)
      .attach('image', image, 'x.png')
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/upload-fixture/someone-elses-post')
      .set('Cookie', cookie)
      .attach('image', image, 'x.png')
      .expect(404);
  });
  it('sanitizes filesystem failures and adds no standalone upload POST endpoint', async () => {
    jest
      .spyOn(app.get(UploadStorage), 'write')
      .mockRejectedValueOnce(new Error('synthetic-private-path-diagnostic'));
    const response = await upload().expect(500);
    expect(response.body.message).toBe('Image could not be stored');
    expect(JSON.stringify(response.body)).not.toContain(
      'synthetic-private-path',
    );
    await request(app.getHttpServer())
      .post('/api/uploads')
      .set('Cookie', cookie)
      .expect(404);
  });
  it('does not serve staging, dotfiles, directory indexes or traversal outside the public root', async () => {
    await fs.writeFile(join(root, 'staging', 'private.txt'), 'not-public');
    await fs.writeFile(join(root, 'public', '.hidden'), 'not-public');
    for (const path of [
      '/uploads/',
      '/uploads/.hidden',
      '/uploads/staging/private.txt',
      '/uploads/%2e%2e/staging/private.txt',
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(404);
      expect(response.text).not.toContain('not-public');
    }
  });
});
