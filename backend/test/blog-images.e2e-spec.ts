import { INestApplication, Logger } from '@nestjs/common';
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
import { PostImagesService } from '../src/blog/post-images.service';
import { Post } from '../src/blog/schemas/post.schema';
import {
  IMAGE_MAX_BYTES,
  MAX_IMAGES_PER_ENTITY,
  PostStatus,
  Role,
} from '../src/common';
import { setupApp, buildSwaggerDocument } from '../src/setup-app';
import { UploadService } from '../src/uploads';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';
import { UploadRecoveryService } from '../src/uploads/upload-recovery.service';
import { UploadStorage } from '../src/uploads/upload-storage';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

describe('BLG-10 actual AppModule, images, storage, ownership and failure consistency', () => {
  let app: INestApplication,
    mongo: MongoMemoryServer,
    root: string,
    db: Connection;
  let posts: Model<Post>, uploads: UploadService;
  let ownerId: string,
    otherId: string,
    cookie: string,
    otherCookie: string,
    adminCookie: string;
  let png: Buffer, jpeg: Buffer;
  const secret = 'blg10-test-access-0123456789abcdef';
  const keys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const http = () => request(app.getHttpServer());
  const create = async (
    actor = cookie,
    extra: Record<string, unknown> = {},
  ) => {
    const response = await http()
      .post('/api/posts')
      .set('Cookie', actor)
      .send({ title: 'Synthetic image post', body: 'Synthetic body', ...extra })
      .expect(201);
    return response.body.id as string;
  };
  const attach = (
    id: string,
    actor = cookie,
    buffer = png,
    mime = 'image/png',
  ) =>
    http()
      .post(`/api/posts/${id}/images`)
      .set('Cookie', actor)
      .attach('image', buffer, {
        filename: '../../untrusted.png',
        contentType: mime,
      });
  const remove = (id: string, imageId: string, actor = cookie) =>
    http().delete(`/api/posts/${id}/images/${imageId}`).set('Cookie', actor);
  const read = (id: string) => posts.findById(id).lean().exec();
  const records = (id: string) =>
    db
      .collection('uploadedFiles')
      .find({ kind: 'post', ownerId: id })
      .toArray();

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
      configSpy.mockRestore();
    }
    db = app.get<Connection>(getConnectionToken());
    posts = db.model<Post>(Post.name);
    uploads = app.get(UploadService);
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
      return {
        id: id.toString(),
        cookie: `access_token=${new JwtService().sign({ sub: id.toString(), role, tokenVersion: 0 }, { secret, expiresIn: '1h' })}`,
      };
    };
    const owner = await user('blg10-owner', Role.USER);
    ownerId = owner.id;
    cookie = owner.cookie;
    const other = await user('blg10-other', Role.USER);
    otherId = other.id;
    otherCookie = other.cookie;
    adminCookie = (await user('blg10-admin', Role.ADMIN)).cookie;
    const image = sharp({
      create: { width: 3, height: 3, channels: 3, background: 'blue' },
    });
    png = await image.clone().png().toBuffer();
    jpeg = await image.clone().jpeg().toBuffer();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each(['png', 'jpeg'])(
    'attaches a real %s, persists only the reference and serves original bytes',
    async (format) => {
      const id = await create();
      const buffer = format === 'png' ? png : jpeg;
      const response = await attach(
        id,
        cookie,
        buffer,
        `image/${format}`,
      ).expect(201);
      expect(Object.keys(response.body).sort()).toEqual(['id', 'url']);
      expect(response.body.id).toMatch(/^[a-f0-9]{24}$/);
      expect(response.body.url).toBe(
        `/uploads/${response.body.id}.${format === 'png' ? 'png' : 'jpg'}`,
      );
      const post = (await read(id))!;
      expect(post.images).toEqual([response.body]);
      expect(post.authorId.toString()).toBe(ownerId);
      expect(await records(id)).toEqual([
        expect.objectContaining({
          ownerId: id,
          kind: 'post',
          state: 'ready',
          sizeBytes: buffer.length,
        }),
      ]);
      const served = await http().get(response.body.url).expect(200);
      expect(served.body).toEqual(buffer);
      expect(served.headers['x-content-type-options']).toBe('nosniff');
    },
  );
  it('rejects guests, other users and even another ADMIN before storing files', async () => {
    const id = await create();
    const save = jest.spyOn(uploads, 'save');
    await attach(id, '').expect(401);
    await attach(id, otherCookie).expect(404);
    await attach(id, adminCookie).expect(404);
    expect(save).not.toHaveBeenCalled();
    expect(await records(id)).toEqual([]);
    expect((await read(id))!.images).toEqual([]);
  });
  it('returns Blog 404 for unknown and malformed post IDs without storage calls', async () => {
    const save = jest.spyOn(uploads, 'save');
    for (const id of [new Types.ObjectId().toString(), 'not-an-id'])
      await attach(id).expect(404);
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects missing and empty files without changing existing references', async () => {
    const id = await create();
    const first = await attach(id).expect(201);
    await http()
      .post(`/api/posts/${id}/images`)
      .set('Cookie', cookie)
      .expect(400);
    await attach(id, cookie, Buffer.alloc(0)).expect(400);
    expect((await read(id))!.images).toEqual([first.body]);
    expect((await records(id)).length).toBe(1);
  });
  it.each([
    ['unsupported format', 'image/gif', Buffer.from('GIF89a-data')],
    [
      'MIME mismatch',
      'image/jpeg',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ],
    [
      'corrupt PNG',
      'image/png',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]),
    ],
    ['corrupt JPEG', 'image/jpeg', Buffer.from([255, 216, 255, 1, 2])],
  ])(
    'rejects %s using shared content validation',
    async (_name, mime, buffer) => {
      const id = await create();
      await attach(id, cookie, buffer as Buffer, mime as string).expect(400);
      expect((await read(id))!.images).toEqual([]);
      expect(await records(id)).toEqual([]);
    },
  );
  it('rejects oversized files and accepts the exact 5 MiB boundary', async () => {
    const id = await create();
    await attach(id, cookie, Buffer.alloc(IMAGE_MAX_BYTES + 1)).expect(413);
    const exact = Buffer.concat([
      png,
      Buffer.alloc(IMAGE_MAX_BYTES - png.length),
    ]);
    await attach(id, cookie, exact).expect(201);
    expect((await records(id))[0].sizeBytes).toBe(IMAGE_MAX_BYTES);
  });
  it('rejects extra fields, files and unexpected file names', async () => {
    const id = await create();
    await attach(id).field('authorId', otherId).expect(400);
    await attach(id).attach('image', png, 'second.png').expect(400);
    await http()
      .post(`/api/posts/${id}/images`)
      .set('Cookie', cookie)
      .attach('file', png, 'wrong.png')
      .expect(400);
    expect(await records(id)).toEqual([]);
    expect((await read(id))!.images).toEqual([]);
  });
  it('allows five images, rejects a sixth without changing files/references', async () => {
    const id = await create();
    const refs = [];
    for (let i = 0; i < MAX_IMAGES_PER_ENTITY; i++)
      refs.push((await attach(id).expect(201)).body);
    await attach(id).expect(409);
    expect((await read(id))!.images).toEqual(refs);
    expect((await records(id)).length).toBe(5);
  });
  it('uses both shared capacity reservations and conditional Post updates under concurrent uploads', async () => {
    const id = await create();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => attach(id)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      201, 201, 201, 201, 201, 409, 409, 409,
    ]);
    const post = (await read(id))!;
    expect(post.images.length).toBe(5);
    expect(new Set(post.images.map((i) => i.id)).size).toBe(5);
    expect((await records(id)).length).toBe(5);
    for (const ref of post.images) await http().get(ref.url).expect(200);
  });
  it('does not exceed five references when unmanaged legacy references already occupy slots', async () => {
    const id = await create();
    const legacy = Array.from({ length: 4 }, (_, i) => ({
      id: `legacy${i}`,
      url: `/uploads/legacy${i}.png`,
    }));
    await posts.updateOne({ _id: id }, { $set: { images: legacy } });
    const results = await Promise.all([attach(id), attach(id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await read(id))!.images.slice(0, 4)).toEqual(legacy);
    expect((await read(id))!.images.length).toBe(5);
    expect((await records(id)).length).toBe(1);
  });
  it('compensates a definite non-match when the parent was deleted after storage', async () => {
    const id = await create();
    const original = uploads.save.bind(uploads);
    jest.spyOn(uploads, 'save').mockImplementationOnce(async (...args) => {
      const ref = await original(...args);
      await posts.deleteOne({ _id: id });
      return ref;
    });
    await attach(id).expect(404);
    expect(await records(id)).toEqual([]);
  });
  it('uses durable shared deletion recovery if compensation cannot unlink a definitely unattached file', async () => {
    const id = await create();
    const original = uploads.save.bind(uploads);
    jest.spyOn(uploads, 'save').mockImplementationOnce(async (...args) => {
      const ref = await original(...args);
      await posts.deleteOne({ _id: id });
      return ref;
    });
    const failure = jest
      .spyOn(app.get(UploadStorage), 'remove')
      .mockRejectedValue(new Error('synthetic-disk-private'));
    await attach(id).expect(500);
    expect((await records(id))[0].state).toBe('deleting');
    failure.mockRestore();
    await app.get(UploadRecoveryService).sweep();
    expect(await records(id)).toEqual([]);
  });

  it('reconciles a committed attachment with a lost acknowledgement without deleting its file', async () => {
    const id = await create();
    const original = posts.updateOne.bind(posts);
    jest
      .spyOn(posts, 'updateOne')
      .mockImplementationOnce((...args: Parameters<typeof posts.updateOne>) => {
        const query = original(...args);
        const execute = query.exec.bind(query);
        jest.spyOn(query, 'exec').mockImplementationOnce(async () => {
          await execute();
          throw new Error('synthetic-lost-ack');
        });
        return query;
      });
    const result = await attach(id).expect(201);
    expect((await read(id))!.images).toEqual([result.body]);
    await http().get(result.body.url).expect(200);
    expect((await records(id))[0].state).toBe('ready');
  });
  it('retains a ready file on uncertain attachment failure and logs identifiers without raw diagnostics', async () => {
    const id = await create();
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(posts, 'updateOne').mockImplementationOnce(() => {
      throw new Error('synthetic-private-driver-path');
    });
    const response = await attach(id).expect(500);
    const metadata = await records(id);
    expect((await read(id))!.images).toEqual([]);
    expect(metadata).toHaveLength(1);
    expect(metadata[0].state).toBe('ready');
    await http().get(`/uploads/${metadata[0].storageKey}`).expect(200);
    const logs = JSON.stringify([
      warning.mock.calls,
      errors.mock.calls,
      response.body,
    ]);
    expect(logs).toContain(id);
    expect(logs).toContain(metadata[0]._id.toString());
    expect(logs).not.toContain('synthetic-private-driver-path');
    expect(logs).not.toContain(root);
    // The fixture knows its injected write never committed. Real unknown outcomes require operator reconciliation.
    await uploads.removeForTarget(metadata[0]._id.toString(), {
      kind: 'post',
      ownerId: id,
    });
  });
  it('keeps references intact after failed shared storage writes', async () => {
    const id = await create();
    const first = await attach(id).expect(201);
    jest
      .spyOn(app.get(UploadStorage), 'write')
      .mockRejectedValueOnce(new Error('synthetic-private-filesystem'));
    const response = await attach(id).expect(500);
    expect((await read(id))!.images).toEqual([first.body]);
    expect((await records(id)).length).toBe(1);
    expect(JSON.stringify(response.body)).not.toContain(
      'synthetic-private-filesystem',
    );
  });
  it('removes exactly the chosen reference using shared storage and serves other images unchanged', async () => {
    const id = await create();
    const first = await attach(id).expect(201),
      second = await attach(id).expect(201);
    const scoped = jest.spyOn(uploads, 'removeForTarget');
    await remove(id, first.body.id).expect(204);
    expect(scoped).toHaveBeenCalledWith(first.body.id, {
      kind: 'post',
      ownerId: id,
    });
    expect((await read(id))!.images).toEqual([second.body]);
    await http().get(first.body.url).expect(404);
    await http().get(second.body.url).expect(200);
    await remove(id, first.body.id).expect(404);
  });
  it('rejects unauthorized deletion and cross-post upload IDs without touching storage', async () => {
    const id = await create(),
      other = await create(otherCookie);
    const first = await attach(id).expect(201),
      second = await attach(other, otherCookie).expect(201);
    const scoped = jest.spyOn(uploads, 'removeForTarget');
    await remove(id, first.body.id, '').expect(401);
    await remove(id, first.body.id, otherCookie).expect(404);
    await remove(id, first.body.id, adminCookie).expect(404);
    await remove(id, second.body.id).expect(404);
    expect(scoped).not.toHaveBeenCalled();
    await http().get(first.body.url).expect(200);
    await http().get(second.body.url).expect(200);
  });
  it('safely rejects unknown/malformed image/post IDs', async () => {
    const id = await create();
    for (const image of ['invalid', new Types.ObjectId().toString()])
      await remove(id, image).expect(404);
    await remove('invalid', new Types.ObjectId().toString()).expect(404);
  });
  it('detaches a forged legacy foreign reference without deleting the foreign post’s file', async () => {
    const id = await create(),
      other = await create(otherCookie);
    const foreign = await attach(other, otherCookie).expect(201);
    await posts.updateOne({ _id: id }, { $set: { images: [foreign.body] } });
    await remove(id, foreign.body.id).expect(204);
    expect((await read(id))!.images).toEqual([]);
    expect((await read(other))!.images).toEqual([foreign.body]);
    await http().get(foreign.body.url).expect(200);
  });
  it('handles concurrent removals and uploads without replacing a stale array', async () => {
    const id = await create();
    const first = await attach(id).expect(201),
      second = await attach(id).expect(201),
      keep = await attach(id).expect(201);
    const results = await Promise.all([
      remove(id, first.body.id),
      remove(id, second.body.id),
      attach(id),
    ]);
    expect(results.map((r) => r.status)).toEqual([204, 204, 201]);
    expect((await read(id))!.images.map((i) => i.id).sort()).toEqual(
      [keep.body.id, results[2].body.id].sort(),
    );
    const storage = app.get(UploadStorage);
    const original = storage.remove.bind(storage);
    const storageCodes: string[] = [];
    jest.spyOn(storage, 'remove').mockImplementation(async (record) => {
      try {
        await original(record);
      } catch (error) {
        storageCodes.push((error as NodeJS.ErrnoException).code ?? 'UNKNOWN');
        throw error;
      }
    });
    for (let attempt = 0; attempt < 20; attempt++) {
      const ref =
        attempt === 0 ? keep.body : (await attach(id).expect(201)).body;
      const same = await Promise.all([remove(id, ref.id), remove(id, ref.id)]);
      expect(storageCodes).toEqual([]);
      expect(
        same
          .map((r) => ({ status: r.status, message: r.body.message }))
          .sort((a, b) => a.status - b.status),
      ).toEqual([
        { status: 204, message: undefined },
        { status: 404, message: 'Post image not found' },
      ]);
    }
  });
  it('keeps membership on storage failure, uses shared recovery, then permits deletion retry', async () => {
    const id = await create();
    const ref = await attach(id).expect(201);
    const failure = jest
      .spyOn(app.get(UploadStorage), 'remove')
      .mockRejectedValue(new Error('synthetic-storage-private'));
    const response = await remove(id, ref.body.id).expect(500);
    expect((await read(id))!.images).toEqual([ref.body]);
    expect((await records(id))[0].state).toBe('deleting');
    expect(JSON.stringify(response.body)).not.toContain(
      'synthetic-storage-private',
    );
    failure.mockRestore();
    await app.get(UploadRecoveryService).sweep();
    expect(await records(id)).toEqual([]);
    await remove(id, ref.body.id).expect(204);
    expect((await read(id))!.images).toEqual([]);
  });
  it('reports a failed Post pull after unlink, retains a retry handle and completes retry safely', async () => {
    const id = await create();
    const ref = await attach(id).expect(201);
    jest.spyOn(posts, 'updateOne').mockImplementationOnce(() => {
      throw new Error('synthetic-driver-private');
    });
    await remove(id, ref.body.id).expect(500);
    expect((await read(id))!.images).toEqual([ref.body]);
    await http().get(ref.body.url).expect(404);
    await remove(id, ref.body.id).expect(204);
    expect((await read(id))!.images).toEqual([]);
  });
  it('blocks create/PATCH image bypass, including forged valid upload IDs and clearing arrays', async () => {
    const id = await create();
    const ref = await attach(id).expect(201);
    await http()
      .post('/api/posts')
      .set('Cookie', otherCookie)
      .send({ title: 'Forged', body: 'Body', images: [ref.body] })
      .expect(400);
    for (const images of [[], [ref.body], null])
      await http()
        .patch(`/api/posts/${id}`)
        .set('Cookie', cookie)
        .send({ images })
        .expect(400);
    await http()
      .patch(`/api/posts/${id}`)
      .set('Cookie', cookie)
      .send({ title: 'Edited title', tags: [' Tag '] })
      .expect(200);
    expect((await read(id))!.images).toEqual([ref.body]);
    expect((await read(id))!.title).toBe('Edited title');
  });
  it('preserves draft/published/hidden visibility and existing image response shape', async () => {
    const id = await create();
    const ref = await attach(id).expect(201);
    await http().get(`/api/posts/${id}`).expect(404);
    const published = await http()
      .patch(`/api/posts/${id}`)
      .set('Cookie', cookie)
      .send({ status: PostStatus.PUBLISHED })
      .expect(200);
    expect(published.body.images).toEqual([ref.body]);
    expect(
      (await http().get(`/api/posts/${id}`).expect(200)).body.images,
    ).toEqual([ref.body]);
    await posts.updateOne({ _id: id }, { $set: { isHidden: true } });
    await http().get(`/api/posts/${id}`).expect(404);
    // Shared upload URLs are public; BLG-10 preserves this documented storage limitation.
    await http().get(ref.body.url).expect(200);
    await remove(id, ref.body.id).expect(204);
  });
  it('cleans managed images when deleting a post, while preserving foreign legacy files', async () => {
    const id = await create(),
      other = await create(otherCookie);
    const ref = await attach(id).expect(201),
      foreign = await attach(other, otherCookie).expect(201);
    await posts.updateOne({ _id: id }, { $push: { images: foreign.body } });
    await http().delete(`/api/posts/${id}`).set('Cookie', cookie).expect(204);
    expect(await read(id)).toBeNull();
    expect(await records(id)).toEqual([]);
    await http().get(ref.body.url).expect(404);
    await http().get(foreign.body.url).expect(200);
  });
  it('keeps a post available for retry when pre-deletion image cleanup fails', async () => {
    const id = await create();
    const ref = await attach(id).expect(201);
    jest
      .spyOn(app.get(UploadStorage), 'remove')
      .mockRejectedValueOnce(new Error('synthetic-disk-failure'));
    await http().delete(`/api/posts/${id}`).set('Cookie', cookie).expect(500);
    expect((await read(id))!.images).toEqual([ref.body]);
    await http().delete(`/api/posts/${id}`).set('Cookie', cookie).expect(204);
    expect(await read(id)).toBeNull();
    expect(await records(id)).toEqual([]);
  });
  it('requires post deletion retry if another image arrives after the cleanup snapshot', async () => {
    const id = await create();
    const old = await attach(id).expect(201);
    const service = app.get(PostImagesService);
    const original = service.removeStoredImages.bind(service);
    let added: { id: string; url: string };
    jest
      .spyOn(service, 'removeStoredImages')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        added = (await attach(id).expect(201)).body;
      });
    await http().delete(`/api/posts/${id}`).set('Cookie', cookie).expect(409);
    expect((await read(id))!.images).toEqual([old.body, added!]);
    await http().get(added!.url).expect(200);
    await http().delete(`/api/posts/${id}`).set('Cookie', cookie).expect(204);
    expect(await records(id)).toEqual([]);
  });
  it('documents both real registered endpoints and multipart limits in Swagger', () => {
    const doc = buildSwaggerDocument(app);
    expect(doc.paths['/api/posts'].post!.description).toContain('omitted images or images: []');
    expect(doc.paths['/api/posts/{id}'].patch!.description).toContain('rejects every supplied images field');
    expect(doc.components!.schemas!.CreatePostDto).toHaveProperty('properties.images.maxItems', 0);
    const upload = doc.paths['/api/posts/{id}/images'].post!;
    const deletion = doc.paths['/api/posts/{id}/images/{imageId}'].delete!;
    expect(upload.security).toEqual([{ cookie: [] }]);
    expect(deletion.security).toEqual([{ cookie: [] }]);
    expect(upload.requestBody).toHaveProperty(
      'content.multipart/form-data.schema.properties.image.format',
      'binary',
    );
    for (const status of [
      '201',
      '400',
      '401',
      '403',
      '404',
      '409',
      '413',
      '500',
    ])
      expect(upload.responses).toHaveProperty(status);
    for (const status of ['204', '401', '403', '404', '500'])
      expect(deletion.responses).toHaveProperty(status);
  });
});
