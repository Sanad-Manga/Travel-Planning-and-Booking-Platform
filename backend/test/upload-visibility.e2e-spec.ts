import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { Role } from '../src/common';
import { setupApp } from '../src/setup-app';
import { UploadService } from '../src/uploads';
import { UploadedFile } from '../src/uploads/schemas/uploaded-file.schema';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';
import { Post } from '../src/blog/schemas/post.schema';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

type Viewer = 'anonymous' | 'other' | 'author' | 'admin';
type State = 'draft' | 'published' | 'hidden' | 'deleted' | 'orphan';
const scenarios = (
  ['draft', 'published', 'hidden', 'deleted', 'orphan'] as State[]
).flatMap((state) =>
  (['anonymous', 'other', 'author', 'admin'] as Viewer[]).map((viewer) => ({
    state,
    viewer,
    expected:
      state === 'published' ||
      (state === 'draft' && viewer === 'author') ||
      (state === 'hidden' && (viewer === 'author' || viewer === 'admin'))
        ? 200
        : 404,
  })),
);

describe('GH-116 production AppModule/static routing: private Blog images', () => {
  let app: INestApplication,
    mongo: MongoMemoryServer,
    root: string,
    db: Connection;
  let files: Model<UploadedFile>, posts: Model<Post>, uploads: UploadService;
  let image: Buffer, authorId: string;
  const cookies = {} as Record<Viewer, string>;
  const access = 'gh116-fixture-access-0123456789abcdef';
  const refresh = 'gh116-fixture-refresh-0123456789abcdef';
  const keys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const prior = new Map(keys.map((key) => [key, process.env[key]]));
  const http = () => request(app.getHttpServer());
  const imageRequest = (method: 'get' | 'head', url: string) =>
    http()[method](url);
  const sign = (
    claims: Record<string, unknown>,
    secret = access,
    expiresIn = 3600,
  ) => `access_token=${new JwtService().sign(claims, { secret, expiresIn })}`;
  const claim = (extra: Record<string, unknown> = {}) => ({
    sub: authorId,
    role: Role.USER,
    tokenVersion: 0,
    ...extra,
  });
  const fixture = async (state: State = 'draft') => {
    const created = await http()
      .post('/api/posts')
      .set('Cookie', cookies.author)
      .send({
        title: 'Synthetic private image',
        body: 'Synthetic body',
        status: state === 'draft' ? 'DRAFT' : 'PUBLISHED',
      })
      .expect(201);
    const id = created.body.id as string;
    const stored = await http()
      .post(`/api/posts/${id}/images`)
      .set('Cookie', cookies.author)
      .attach('image', image, {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(201);
    if (state === 'hidden')
      await posts.updateOne({ _id: id }, { $set: { isHidden: true } });
    if (state === 'deleted') await posts.deleteOne({ _id: id });
    if (state === 'orphan')
      await posts.updateOne({ _id: id }, { $set: { images: [] } });
    return {
      postId: id,
      id: stored.body.id as string,
      url: stored.body.url as string,
    };
  };
  const assertDenied = (response: request.Response, method: string) => {
    expect(response.status).toBe(404);
    expect(response.headers['content-type'] ?? '').not.toMatch(/^image\//);
    expect(response.headers['content-range']).toBeUndefined();
    if (method === 'get')
      expect(response.body).toMatchObject({
        statusCode: 404,
        message: 'Image not found',
      });
    else expect(response.text ?? '').toBe('');
    expect(Buffer.isBuffer(response.body) && response.body.length > 0).toBe(
      false,
    );
  };
  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'gh116-images-'));
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: access,
      JWT_REFRESH_SECRET: refresh,
      COOKIE_SECURE: 'false',
    });
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const spy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        configure({ ...options, ignoreEnvFile: true }),
      );
    try {
      const { AppModule } = await import('../src/app.module');
      const adapter = new ExpressAdapter();
      const host = new HttpAdapterHost();
      host.httpAdapter = adapter;
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(HttpAdapterHost)
        .useValue(host)
        .overrideProvider(UPLOAD_OPTIONS)
        .useValue({
          root,
          leaseMs: 60000,
          recoveryIntervalMs: 3600000,
          recoveryBatchSize: 50,
        })
        .compile();
      app = module.createNestApplication(adapter);
      app.useLogger(false);
      setupApp(app);
      await app.listen(0, '127.0.0.1');
    } finally {
      spy.mockRestore();
    }
    db = app.get<Connection>(getConnectionToken());
    files = db.model<UploadedFile>(UploadedFile.name);
    posts = db.model<Post>(Post.name);
    uploads = app.get(UploadService);
    cookies.anonymous = '';
    for (const viewer of ['author', 'other', 'admin'] as const) {
      const _id = new Types.ObjectId();
      const role = viewer === 'admin' ? Role.ADMIN : Role.USER;
      await db.collection('users').insertOne({
        _id,
        name: `GH116 ${viewer}`,
        email: `gh116-${viewer}@example.test`,
        passwordHash: 'not-a-login-fixture',
        role,
        status: 'ACTIVE',
        tokenVersion: 0,
        consentAcceptedAt: new Date(),
        createdAt: new Date(),
      });
      if (viewer === 'author') authorId = _id.toString();
      cookies[viewer] = sign({ sub: _id.toString(), role, tokenVersion: 0 });
    }
    image = await sharp({
      create: { width: 3, height: 3, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.collection('users').updateOne(
      { _id: new Types.ObjectId(authorId) },
      {
        $set: {
          status: 'ACTIVE',
          tokenVersion: 0,
          mustChangePassword: false,
        },
      },
    );
  });
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('regression: anonymous draft URL cannot bypass the private post API', async () => {
    const ref = await fixture();
    await http().get(`/api/posts/${ref.postId}`).expect(404);
    const response = await http().get(ref.url);
    assertDenied(response, 'get');
  });

  describe.each(['get', 'head'] as const)(
    '%s visibility decisions',
    (method) => {
      it.each(scenarios)(
        '$state image / $viewer -> $expected',
        async ({ state, viewer, expected }) => {
          const ref = await fixture(state);
          const call = imageRequest(method, ref.url);
          if (cookies[viewer]) call.set('Cookie', cookies[viewer]);
          const response = await call;
          if (expected === 404) {
            assertDenied(response, method);
            expect(JSON.stringify(response.body)).not.toContain(ref.postId);
          } else {
            expect(response.status).toBe(200);
            expect(response.headers['cache-control']).toBe('no-store');
            expect(response.headers['x-content-type-options']).toBe('nosniff');
            expect(response.headers['content-type']).toMatch(/^image\/png/);
            if (method === 'get') expect(response.body).toEqual(image);
            else expect(response.text ?? '').toBe('');
          }
        },
      );
    },
  );

  it.each([
    'invalid',
    'wrong key',
    'expired',
    'wrong role',
    'wrong version',
    'malformed version',
    'refresh as access',
    'suspended',
    'deactivated',
    'forced change',
    'missing account',
  ])('rejects private image access with %s authentication', async (mode) => {
    const ref = await fixture();
    let cookie = cookies.author;
    if (mode === 'invalid') cookie = 'access_token=not-a-jwt';
    if (mode === 'wrong key')
      cookie = sign(claim(), 'gh116-wrong-key-0123456789abcdef');
    if (mode === 'expired') cookie = sign(claim(), access, -1);
    if (mode === 'wrong role') cookie = sign(claim({ role: 'SUPERUSER' }));
    if (mode === 'wrong version')
      await db
        .collection('users')
        .updateOne(
          { _id: new Types.ObjectId(authorId) },
          { $set: { tokenVersion: 1 } },
        );
    if (mode === 'malformed version')
      cookie = sign(claim({ tokenVersion: '0' }));
    if (mode === 'refresh as access') cookie = sign(claim(), refresh);
    if (mode === 'suspended' || mode === 'deactivated')
      await db
        .collection('users')
        .updateOne(
          { _id: new Types.ObjectId(authorId) },
          { $set: { status: mode.toUpperCase() } },
        );
    if (mode === 'forced change')
      await db
        .collection('users')
        .updateOne(
          { _id: new Types.ObjectId(authorId) },
          { $set: { mustChangePassword: true } },
        );
    if (mode === 'missing account')
      cookie = sign(claim({ sub: new Types.ObjectId().toString() }));
    for (const method of ['get', 'head'] as const)
      assertDenied(
        await imageRequest(method, ref.url).set('Cookie', cookie),
        method,
      );
  });

  it('rejects credential-version replay and accepts a fresh current author version', async () => {
    const ref = await fixture();
    await db
      .collection('users')
      .updateOne(
        { _id: new Types.ObjectId(authorId) },
        { $set: { tokenVersion: 1 } },
      );
    assertDenied(
      await http().get(ref.url).set('Cookie', cookies.author),
      'get',
    );
    expect(
      (
        await http()
          .get(ref.url)
          .set('Cookie', sign(claim({ tokenVersion: 1 })))
          .expect(200)
      ).body,
    ).toEqual(image);
  });

  it('does not accept refresh cookies or revoked refresh tokens as image credentials', async () => {
    const ref = await fixture();
    const token = new JwtService().sign(
      { sub: authorId, tokenVersion: 0 },
      { secret: refresh, expiresIn: 600, jwtid: 'gh116-refresh-revoked' },
    );
    await http()
      .post('/api/auth/logout')
      .set('Cookie', `refresh_token=${token}`)
      .expect(200);
    await http()
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${token}`)
      .expect(401);
    assertDenied(
      await http().get(ref.url).set('Cookie', `refresh_token=${token}`),
      'get',
    );
    assertDenied(
      await http().get(ref.url).set('Cookie', `access_token=${token}`),
      'get',
    );
  });

  it('rechecks visibility before conditional/range responses on every transition', async () => {
    const ref = await fixture();
    await posts.updateOne(
      { _id: ref.postId },
      { $set: { status: 'PUBLISHED' } },
    );
    const publicResponse = await http().get(ref.url).expect(200);
    expect(publicResponse.body).toEqual(image);
    await posts.updateOne({ _id: ref.postId }, { $set: { isHidden: true } });
    for (const method of ['get', 'head'] as const) {
      assertDenied(
        await imageRequest(method, ref.url).set(
          'If-None-Match',
          publicResponse.headers.etag,
        ),
        method,
      );
      assertDenied(
        await imageRequest(method, ref.url).set(
          'If-Modified-Since',
          publicResponse.headers['last-modified'],
        ),
        method,
      );
      assertDenied(
        await imageRequest(method, ref.url).set('Range', 'bytes=0-15'),
        method,
      );
    }
    const allowed = await http()
      .get(ref.url)
      .set('Cookie', cookies.author)
      .set('Range', 'bytes=0-15')
      .expect(206);
    expect(allowed.body).toEqual(image.subarray(0, 16));
    expect(allowed.headers['cache-control']).toBe('no-store');
    const conditional = await http()
      .get(ref.url)
      .set('Cookie', cookies.author)
      .set('If-None-Match', publicResponse.headers.etag)
      .expect(304);
    expect(conditional.headers['cache-control']).toBe('no-store');
    await posts.updateOne({ _id: ref.postId }, { $set: { isHidden: false } });
    await http().get(ref.url).expect(200);
    await posts.deleteOne({ _id: ref.postId });
    assertDenied(await http().get(ref.url), 'get');
  });

  it('ACC-12: the published post image of a deactivated author is served to admins only, and again once reactivated', async () => {
    const ref = await fixture('published');
    await http().get(ref.url).expect(200);
    await db
      .collection('users')
      .updateOne({ _id: new Types.ObjectId(authorId) }, { $set: { status: 'DEACTIVATED' } });
    assertDenied(await http().get(ref.url), 'get');
    assertDenied(await http().get(ref.url).set('Cookie', cookies.other), 'get');
    assertDenied(await http().get(ref.url).set('Cookie', cookies.author), 'get');
    await http().get(ref.url).set('Cookie', cookies.admin).expect(200);
    await db
      .collection('users')
      .updateOne({ _id: new Types.ObjectId(authorId) }, { $set: { status: 'ACTIVE' } });
    await http().get(ref.url).expect(200);
  });

  it('does not trust request.user or authentication supplied through a URL/header', async () => {
    const ref = await fixture();
    assertDenied(
      await http()
        .get(`${ref.url}?userId=${authorId}`)
        .set(
          'Authorization',
          `Bearer ${cookies.author.slice('access_token='.length)}`,
        ),
      'get',
    );
  });

  it('blocks static aliases, encodings and traversal without private bytes', async () => {
    const ref = await fixture();
    const name = ref.url.slice('/uploads/'.length);
    for (const url of [
      ref.url + '?download=1',
      '/UPLOADS/' + name,
      '/uploads//' + name,
      '/uploads/' + name + '/',
      '/uploads/%' + name.charCodeAt(0).toString(16) + name.slice(1),
      '/uploads/%2e%2e/uploads/' + name,
      '/uploads/%252e%252e/' + name,
      '/uploads/%2f' + name,
      '/uploads/%5c' + name,
      '/uploads/' + name.replace('.png', '.PNG'),
      '/uploads/' + name + '.txt',
      '/api' + ref.url,
    ]) {
      for (const method of ['get', 'head'] as const) {
        const response = await imageRequest(method, url);
        expect(response.status).toBe(404);
        expect(response.headers['content-type'] ?? '').not.toMatch(/^image\//);
        expect(Buffer.isBuffer(response.body) && response.body.length > 0).toBe(
          false,
        );
      }
    }
    for (const url of [
      '/uploads',
      '/uploads/',
      '/uploads/staging/private.part',
      '/uploads/.hidden',
      '/uploads/nope.png',
      '/uploads/%zz',
    ])
      await http().get(url).expect(404);
  });

  it.each(['hotel', 'activity', 'airline'] as const)(
    'preserves real %s upload URLs, GET/HEAD/conditional/range behavior',
    async (kind) => {
      const ref = await uploads.save(
        { buffer: image, size: image.length, mimetype: 'image/png' },
        { kind, ownerId: 'gh116-public-' + kind },
      );
      const response = await http()
        .get(ref.url)
        .set('Cookie', 'access_token=invalid')
        .expect(200);
      expect(response.body).toEqual(image);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).not.toBe('no-store');
      await http().head(ref.url).expect(200);
      expect(
        (await http().get(ref.url).set('Range', 'bytes=0-15').expect(206)).body,
      ).toEqual(image.subarray(0, 16));
      await http()
        .get(ref.url)
        .set('If-None-Match', response.headers.etag)
        .expect(304);
    },
  );

  it('does not let an invalid cookie block an otherwise public Blog image', async () => {
    const ref = await fixture('published');
    await http().get(ref.url).set('Cookie', 'access_token=invalid').expect(200);
  });

  it.each(['get', 'head'] as const)(
    'fails closed on %s metadata read failure without altering records or files',
    async (method) => {
      const ref = await fixture('published');
      const before = await files.findById(ref.id).lean();
      jest.spyOn(files, 'findById').mockImplementationOnce(() => {
        throw new Error('synthetic-private-db-path');
      });
      const response = await imageRequest(method, ref.url).expect(503);
      expect(response.headers['content-type'] ?? '').not.toMatch(/^image\//);
      expect(JSON.stringify(response.body)).not.toContain(
        'synthetic-private-db-path',
      );
      expect(await files.findById(ref.id).lean()).toEqual(before);
      expect(await fs.readFile(join(root, 'public', `${ref.id}.png`))).toEqual(
        image,
      );
    },
  );

  it('denies physical files with no metadata, mismatched names or non-ready metadata', async () => {
    const ref = await fixture('published');
    await db
      .collection('uploadedFiles')
      .deleteOne({ _id: new Types.ObjectId(ref.id) });
    assertDenied(await http().get(ref.url), 'get');
    const wrong = await fixture('published');
    await files.updateOne(
      { _id: wrong.id },
      { $set: { storageKey: wrong.id + '.jpg' } },
    );
    assertDenied(await http().get(wrong.url), 'get');
    const deleting = await fixture('published');
    await files.updateOne(
      { _id: deleting.id },
      { $set: { state: 'deleting' } },
    );
    assertDenied(await http().get(deleting.url), 'get');
    await http()
      .get('/uploads/' + new Types.ObjectId() + '.png')
      .expect(404);
  });

  it('fails closed if Post or account-state lookup fails', async () => {
    const ref = await fixture();
    jest.spyOn(posts, 'findById').mockImplementationOnce(() => {
      throw new Error('synthetic-private-post-path');
    });
    await http().get(ref.url).set('Cookie', cookies.author).expect(503);
    const users = db.model('User');
    jest.spyOn(users, 'findById').mockImplementationOnce(() => {
      throw new Error('synthetic-private-account-path');
    });
    await http().get(ref.url).set('Cookie', cookies.author).expect(503);
  });
  it('returns 404 when ready metadata exists but the physical file is missing', async () => {
    const ref = await fixture('published');
    await fs.unlink(join(root, 'public', `${ref.id}.png`));
    for (const method of ['get', 'head'] as const)
      await imageRequest(method, ref.url).expect(404);
    expect(await files.exists({ _id: ref.id })).toBeTruthy();
  });

  it('preserves JPEG URLs, MIME and exact bytes after Blog authorization', async () => {
    const parent = await fixture();
    const jpeg = await sharp(image).jpeg().toBuffer();
    const ref = await http()
      .post(`/api/posts/${parent.postId}/images`)
      .set('Cookie', cookies.author)
      .attach('image', jpeg, {
        filename: 'fixture.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    expect(ref.body.url).toMatch(/\.jpg$/);
    assertDenied(await http().get(ref.body.url as string), 'get');
    for (const method of ['get', 'head'] as const) {
      const response = await imageRequest(method, ref.body.url as string)
        .set('Cookie', cookies.author)
        .expect(200);
      expect(response.headers['content-type']).toMatch(/^image\/jpeg/);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('no-store');
      if (method === 'get') expect(response.body).toEqual(jpeg);
    }
  });
});
