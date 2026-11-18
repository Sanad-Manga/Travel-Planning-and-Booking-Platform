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
import { Post } from '../src/blog/schemas/post.schema';
import { IMAGE_MAX_BYTES, MAX_IMAGES_PER_ENTITY, Role } from '../src/common';
import { buildSwaggerDocument, setupApp } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

describe('BLG-10 attach and remove images on a post (e2e)', () => {
  let app: INestApplication, mongo: MongoMemoryServer, root: string, db: Connection;
  let posts: Model<Post>;
  let cookie: string, otherCookie: string;
  let png: Buffer, jpeg: Buffer;
  const secret = 'blg10-test-access-0123456789abcdef';
  const keys = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECURE'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  const http = () => request(app.getHttpServer());
  const create = async (actor = cookie) =>
    (await http().post('/api/posts').set('Cookie', actor).send({ title: 'Image post', body: 'Body' }).expect(201)).body
      .id as string;
  const attach = (id: string, actor = cookie, buffer = png, contentType = 'image/png') =>
    http().post(`/api/posts/${id}/images`).set('Cookie', actor).attach('image', buffer, { filename: 'photo', contentType });
  const remove = (id: string, imageId: string, actor = cookie) =>
    http().delete(`/api/posts/${id}/images/${imageId}`).set('Cookie', actor);
  const images = async (id: string) => (await posts.findById(id).lean().exec())?.images;
  const fileOf = (url: string) => join(root, 'public', url.replace('/uploads/', ''));
  const exists = (path: string) => fs.access(path).then(() => true, () => false);

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'blg10-images-'));
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: 'blg10-test-refresh-0123456789abcdef',
      COOKIE_SECURE: 'false',
    });
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const configSpy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) => configure({ ...options, ignoreEnvFile: true }));
    try {
      const { AppModule } = await import('../src/app.module');
      const adapter = new ExpressAdapter();
      const host = new HttpAdapterHost();
      host.httpAdapter = adapter;
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(HttpAdapterHost)
        .useValue(host)
        .overrideProvider(UPLOAD_OPTIONS)
        .useValue({ root, leaseMs: 60000, recoveryIntervalMs: 3600000, recoveryBatchSize: 50 })
        .compile();
      app = module.createNestApplication(adapter);
      app.useLogger(false);
      setupApp(app);
      await app.listen(0, '127.0.0.1');
    } finally {
      configSpy.mockRestore();
    }
    db = app.get<Connection>(getConnectionToken());
    posts = db.model<Post>(Post.name);
    const user = async (name: string, role: Role) => {
      const id = new Types.ObjectId();
      await db.collection('users').insertOne({
        _id: id,
        name,
        email: `${name}@example.test`,
        passwordHash: 'synthetic-not-for-login',
        role,
        status: 'ACTIVE',
        consentAcceptedAt: new Date(),
        createdAt: new Date(),
      });
      return `access_token=${new JwtService().sign({ sub: id.toString(), role, tokenVersion: 0 }, { secret, expiresIn: '1h' })}`;
    };
    cookie = await user('blg10-owner', Role.USER);
    otherCookie = await user('blg10-other', Role.USER);
    const image = sharp({ create: { width: 3, height: 3, channels: 3, background: 'blue' } });
    png = await image.clone().png().toBuffer();
    jpeg = await image.clone().jpeg().toBuffer();
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

  describe('POST /api/posts/:id/images', () => {
    it.each([
      ['png', 'image/png'],
      ['jpg', 'image/jpeg'],
    ])('attaches a %s, stores the file and the {id,url} reference', async (extension, mime) => {
      const id = await create();
      const res = await attach(id, cookie, extension === 'png' ? png : jpeg, mime).expect(201);
      expect(res.body).toEqual({ id: expect.stringMatching(/^[0-9a-f]{24}$/), url: `/uploads/${res.body.id}.${extension}` });
      expect(await images(id)).toEqual([res.body]);
      expect(await exists(fileOf(res.body.url))).toBe(true);
    });

    it('rejects a wrong type, a fake image and a missing file with 400', async () => {
      const id = await create();
      await attach(id, cookie, Buffer.from('plain text'), 'text/plain').expect(400);
      await attach(id, cookie, Buffer.from('not really a png'), 'image/png').expect(400);
      await http().post(`/api/posts/${id}/images`).set('Cookie', cookie).expect(400);
      expect(await images(id)).toEqual([]);
    });

    it('rejects a file over 5 MB with 413', async () => {
      const id = await create();
      const res = await attach(id, cookie, Buffer.alloc(IMAGE_MAX_BYTES + 1)).expect(413);
      expect(res.body).toMatchObject({ statusCode: 413, path: `/api/posts/${id}/images` });
      expect(await images(id)).toEqual([]);
    });

    it('rejects a 6th image with 409', async () => {
      const id = await create();
      for (let i = 0; i < MAX_IMAGES_PER_ENTITY; i++) await attach(id).expect(201);
      await attach(id).expect(409);
      expect(await images(id)).toHaveLength(MAX_IMAGES_PER_ENTITY);
    });

    it('two uploads at the same time for the last place: one 201, one 409, never 6 images', async () => {
      const id = await create();
      for (let i = 0; i < MAX_IMAGES_PER_ENTITY - 1; i++) await attach(id).expect(201);
      const statuses = (await Promise.all([attach(id), attach(id)])).map((res) => res.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(await images(id)).toHaveLength(MAX_IMAGES_PER_ENTITY);
    });

    it('only the author can attach: guest 401, other user 404, unknown or malformed post 404', async () => {
      const id = await create();
      await attach(id, '').expect(401);
      await attach(id, otherCookie).expect(404);
      await attach(new Types.ObjectId().toString()).expect(404);
      await attach('not-an-id').expect(404);
      expect(await images(id)).toEqual([]);
    });
  });

  describe('DELETE /api/posts/:id/images/:imageId', () => {
    it('removes the reference and the stored file', async () => {
      const id = await create();
      const kept = (await attach(id).expect(201)).body;
      const gone = (await attach(id).expect(201)).body;
      await remove(id, gone.id).expect(204);
      expect(await images(id)).toEqual([kept]);
      expect(await exists(fileOf(gone.url))).toBe(false);
      await remove(id, gone.id).expect(404);
      // The freed place can be used again.
      for (let i = 0; i < MAX_IMAGES_PER_ENTITY - 1; i++) await attach(id).expect(201);
    });

    it('only the author can remove, and only an image of that post', async () => {
      const id = await create();
      const image = (await attach(id).expect(201)).body;
      const otherPost = await create(otherCookie);
      await remove(id, image.id, '').expect(401);
      await remove(id, image.id, otherCookie).expect(404);
      await remove(otherPost, image.id, otherCookie).expect(404);
      await remove(id, new Types.ObjectId().toString()).expect(404);
      expect(await images(id)).toEqual([image]);
      expect(await exists(fileOf(image.url))).toBe(true);
    });
  });

  describe('Post create / edit / delete (BLG-01, BLG-04)', () => {
    it('images cannot be set through the post body', async () => {
      const image = { id: new Types.ObjectId().toString(), url: '/uploads/x.png' };
      const created = await http()
        .post('/api/posts')
        .set('Cookie', cookie)
        .send({ title: 'T', body: 'B', images: [image] })
        .expect(400);
      expect(created.body.details).toEqual([expect.objectContaining({ field: 'images' })]);
      const id = await create();
      await http().patch(`/api/posts/${id}`).set('Cookie', cookie).send({ images: [image] }).expect(400);
      expect(await images(id)).toEqual([]);
    });

    it('deleting a post deletes its image files', async () => {
      const id = await create();
      const image = (await attach(id).expect(201)).body;
      await http().delete(`/api/posts/${id}`).set('Cookie', cookie).expect(204);
      expect(await exists(fileOf(image.url))).toBe(false);
    });
  });

  it('documents both endpoints in Swagger', () => {
    const paths = buildSwaggerDocument(app).paths;
    expect(paths['/api/posts/{id}/images']?.post?.responses).toEqual(
      expect.objectContaining({ 201: expect.anything(), 400: expect.anything(), 404: expect.anything(), 409: expect.anything(), 413: expect.anything() }),
    );
    expect(paths['/api/posts/{id}/images/{imageId}']?.delete?.responses).toEqual(
      expect.objectContaining({ 204: expect.anything(), 404: expect.anything() }),
    );
  });
});
