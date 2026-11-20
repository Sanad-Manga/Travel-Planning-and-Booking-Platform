import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Connection, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { IMAGE_MAX_BYTES, MAX_IMAGES_PER_ENTITY, Role } from '../src/common';
import { setupApp } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

/** GEN-08: hotel photos (max 5 per hotel) and the airline logo (1 per airline), each for its own moderator only. */
describe('GEN-08 hotel photos and airline logo (e2e)', () => {
  let app: INestApplication,
    mongo: MongoMemoryServer,
    root: string,
    db: Connection;
  let png: Buffer, jpeg: Buffer;
  let hotelA: string, hotelB: string, airlineA: string, airlineB: string;
  let hotelModA: string,
    hotelModB: string,
    airlineModA: string,
    airlineModB: string,
    admin: string,
    user: string;
  const secret = 'gen08-test-access-0123456789abcdef';
  const keys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  const http = () => request(app.getHttpServer());
  const addPhoto = (
    id: string,
    cookie: string,
    buffer = png,
    contentType = 'image/png',
  ) =>
    http()
      .post(`/api/hotels/${id}/photos`)
      .set('Cookie', cookie)
      .attach('image', buffer, { filename: 'p', contentType });
  const removePhoto = (id: string, photoId: string, cookie: string) =>
    http().delete(`/api/hotels/${id}/photos/${photoId}`).set('Cookie', cookie);
  const addLogo = (
    id: string,
    cookie: string,
    buffer = png,
    contentType = 'image/png',
  ) =>
    http()
      .post(`/api/airlines/${id}/logo`)
      .set('Cookie', cookie)
      .attach('image', buffer, { filename: 'l', contentType });
  const removeLogo = (id: string, cookie: string) =>
    http().delete(`/api/airlines/${id}/logo`).set('Cookie', cookie);
  const hotelPhotos = async (id: string) =>
    (await db.collection('hotels').findOne({ _id: new Types.ObjectId(id) }))
      ?.photos as { id: string; url: string }[];
  const airlineRow = (id: string) =>
    db.collection('airlines').findOne({ _id: new Types.ObjectId(id) });
  const fileOf = (url: string) =>
    join(root, 'public', url.replace('/uploads/', ''));
  const exists = (path: string) =>
    fs.access(path).then(
      () => true,
      () => false,
    );

  const login = async (
    name: string,
    role: Role,
    extra: Record<string, unknown> = {},
  ) => {
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
      ...extra,
    });
    const claims: Record<string, string> = {};
    if (extra.hotelId) claims.hotelId = String(extra.hotelId);
    if (extra.airlineId) claims.airlineId = String(extra.airlineId);
    return `access_token=${new JwtService().sign({ sub: id.toString(), role, ...claims, tokenVersion: 0 }, { secret, expiresIn: '1h' })}`;
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'gen08-images-'));
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: 'gen08-test-refresh-0123456789abcdef',
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

    const now = new Date();
    const hotel = async (name: string) =>
      (
        await db.collection('hotels').insertOne({
          name,
          nameKey: name.toLowerCase(),
          address: '1 Main St',
          cityId: 'cairo',
          countryCode: 'EG',
          description: 'A hotel',
          photos: [],
          starRating: 4,
          amenities: [],
          cancellationTiers: [],
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
      ).insertedId.toString();
    const airline = async (name: string, code: string) =>
      (
        await db.collection('airlines').insertOne({
          name,
          code,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
      ).insertedId.toString();
    hotelA = await hotel('Hotel A');
    hotelB = await hotel('Hotel B');
    airlineA = await airline('Air A', 'AA');
    airlineB = await airline('Air B', 'BB');

    hotelModA = await login('gen08-hotel-a', Role.HOTEL_MODERATOR, {
      hotelId: new Types.ObjectId(hotelA),
    });
    hotelModB = await login('gen08-hotel-b', Role.HOTEL_MODERATOR, {
      hotelId: new Types.ObjectId(hotelB),
    });
    airlineModA = await login('gen08-air-a', Role.AIRLINE_MODERATOR, {
      airlineId: new Types.ObjectId(airlineA),
    });
    airlineModB = await login('gen08-air-b', Role.AIRLINE_MODERATOR, {
      airlineId: new Types.ObjectId(airlineB),
    });
    admin = await login('gen08-admin', Role.ADMIN);
    user = await login('gen08-user', Role.USER);

    const image = sharp({
      create: { width: 3, height: 3, channels: 3, background: 'blue' },
    });
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

  describe('POST /api/hotels/:id/photos', () => {
    it.each([
      ['png', 'image/png'],
      ['jpg', 'image/jpeg'],
    ])(
      'the hotel moderator attaches a %s: file stored, {id,url} saved on the hotel, shown on its profile',
      async (extension, mime) => {
        const res = await addPhoto(
          hotelA,
          hotelModA,
          extension === 'png' ? png : jpeg,
          mime,
        ).expect(201);
        expect(res.body).toEqual({
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          url: `/uploads/${res.body.id}.${extension}`,
        });
        expect(await hotelPhotos(hotelA)).toContainEqual(res.body);
        expect(await exists(fileOf(res.body.url))).toBe(true);
        const profile = await http().get(`/api/hotels/${hotelA}`).expect(200);
        expect(profile.body.photos).toContainEqual(res.body);
      },
    );

    it('rejects a wrong type, a fake image and a missing file with 400, and stores nothing', async () => {
      const before = (await hotelPhotos(hotelB)).length;
      await addPhoto(
        hotelB,
        hotelModB,
        Buffer.from('plain text'),
        'text/plain',
      ).expect(400);
      await addPhoto(
        hotelB,
        hotelModB,
        Buffer.from('not really a png'),
        'image/png',
      ).expect(400);
      await http()
        .post(`/api/hotels/${hotelB}/photos`)
        .set('Cookie', hotelModB)
        .expect(400);
      expect(await hotelPhotos(hotelB)).toHaveLength(before);
    });

    it('rejects a file over 5 MB with 413', async () => {
      await addPhoto(
        hotelB,
        hotelModB,
        Buffer.alloc(IMAGE_MAX_BYTES + 1),
      ).expect(413);
    });

    it('allows 5 photos and rejects the 6th with 409; two uploads for the last place give one 201 and one 409', async () => {
      const id = (
        await db.collection('hotels').insertOne({
          name: 'Limit Hotel',
          nameKey: 'limit hotel',
          address: '2 Main St',
          cityId: 'cairo',
          countryCode: 'EG',
          description: 'x',
          photos: [],
          starRating: 3,
          amenities: [],
          cancellationTiers: [],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).insertedId.toString();
      const mod = await login('gen08-limit-mod', Role.HOTEL_MODERATOR, {
        hotelId: new Types.ObjectId(id),
      });
      for (let i = 0; i < MAX_IMAGES_PER_ENTITY - 1; i++)
        await addPhoto(id, mod).expect(201);
      const statuses = (
        await Promise.all([addPhoto(id, mod), addPhoto(id, mod)])
      )
        .map((r) => r.status)
        .sort();
      expect(statuses).toEqual([201, 409]);
      await addPhoto(id, mod).expect(409);
      expect(await hotelPhotos(id)).toHaveLength(MAX_IMAGES_PER_ENTITY);
    });

    it('only the moderator of that hotel: guest 401, user 403, admin 403, other hotel moderator 403, airline moderator 403', async () => {
      const before = (await hotelPhotos(hotelB)).length;
      await http()
        .post(`/api/hotels/${hotelB}/photos`)
        .attach('image', png, { filename: 'p', contentType: 'image/png' })
        .expect(401);
      await addPhoto(hotelB, user).expect(403);
      await addPhoto(hotelB, admin).expect(403);
      await addPhoto(hotelB, hotelModA).expect(403);
      await addPhoto(hotelB, airlineModA).expect(403);
      expect(await hotelPhotos(hotelB)).toHaveLength(before);
    });

    it('answers 403 for a malformed hotel id (never a 500)', async () => {
      await addPhoto('not-an-id', hotelModA).expect(403);
    });

    it('a moderator whose hotel no longer exists gets 404 and nothing is stored', async () => {
      const ghost = new Types.ObjectId().toString();
      const mod = await login('gen08-ghost-mod', Role.HOTEL_MODERATOR, {
        hotelId: new Types.ObjectId(ghost),
      });
      await addPhoto(ghost, mod).expect(404);
    });
  });

  describe('DELETE /api/hotels/:id/photos/:photoId', () => {
    it('removes the reference and the stored file; the freed place can be used again', async () => {
      const kept = (await addPhoto(hotelB, hotelModB).expect(201)).body;
      const gone = (await addPhoto(hotelB, hotelModB).expect(201)).body;
      await removePhoto(hotelB, gone.id, hotelModB).expect(204);
      expect(await hotelPhotos(hotelB)).toContainEqual(kept);
      expect(await hotelPhotos(hotelB)).not.toContainEqual(gone);
      expect(await exists(fileOf(gone.url))).toBe(false);
      await removePhoto(hotelB, gone.id, hotelModB).expect(404);
    });

    it('only the hotel moderator, and only a photo of that hotel', async () => {
      const photo = (await addPhoto(hotelA, hotelModA).expect(201)).body;
      const other = (await addPhoto(hotelB, hotelModB).expect(201)).body;
      await http()
        .delete(`/api/hotels/${hotelA}/photos/${photo.id}`)
        .expect(401);
      await removePhoto(hotelA, photo.id, hotelModB).expect(403);
      await removePhoto(hotelA, photo.id, user).expect(403);
      // B's moderator cannot delete B's photo through A's hotel id either (it is not A's photo).
      await removePhoto(hotelA, other.id, hotelModA).expect(404);
      expect(await hotelPhotos(hotelA)).toContainEqual(photo);
      expect(await exists(fileOf(photo.url))).toBe(true);
      expect(await exists(fileOf(other.url))).toBe(true);
    });
  });

  describe('hotel profile body', () => {
    it('photos cannot be set through create or edit; an unknown field is rejected', async () => {
      const photo = {
        id: new Types.ObjectId().toString(),
        url: '/uploads/x.png',
      };
      const edit = await http()
        .patch(`/api/hotels/${hotelA}`)
        .set('Cookie', hotelModA)
        .send({ photos: [photo] })
        .expect(400);
      expect(edit.body.details).toEqual([
        expect.objectContaining({ field: 'photos' }),
      ]);
      await http()
        .post('/api/hotels')
        .set('Cookie', admin)
        .send({
          name: 'Sneaky',
          address: 'a',
          cityId: 'cairo',
          description: 'd',
          starRating: 3,
          photos: [photo],
        })
        .expect(400);
    });
  });

  describe('POST /api/airlines/:id/logo', () => {
    it.each([
      ['png', 'image/png'],
      ['jpg', 'image/jpeg'],
    ])(
      'the airline moderator uploads a %s logo: stored, and the airline shows it as logoUrl',
      async (extension, mime) => {
        const id = (
          await db.collection('airlines').insertOne({
            name: `Air ${extension}`,
            code: extension === 'png' ? 'PN' : 'JP',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        ).insertedId.toString();
        const mod = await login(
          `gen08-air-${extension}`,
          Role.AIRLINE_MODERATOR,
          { airlineId: new Types.ObjectId(id) },
        );
        const res = await addLogo(
          id,
          mod,
          extension === 'png' ? png : jpeg,
          mime,
        ).expect(201);
        expect(res.body).toEqual({
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          url: `/uploads/${res.body.id}.${extension}`,
        });
        expect(await exists(fileOf(res.body.url))).toBe(true);
        expect(await airlineRow(id)).toMatchObject({
          logoId: res.body.id,
          logoUrl: res.body.url,
        });
        const profile = await http()
          .get(`/api/airlines/${id}`)
          .set('Cookie', mod)
          .expect(200);
        expect(profile.body.logoUrl).toBe(res.body.url);
        expect(profile.body).not.toHaveProperty('logoId');
      },
    );

    it('a second logo is refused with 409 and its file is removed; two at the same time give one 201 and one 409', async () => {
      const id = (
        await db.collection('airlines').insertOne({
          name: 'Air Two',
          code: 'TW',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).insertedId.toString();
      const mod = await login('gen08-air-two', Role.AIRLINE_MODERATOR, {
        airlineId: new Types.ObjectId(id),
      });
      const statuses = (await Promise.all([addLogo(id, mod), addLogo(id, mod)]))
        .map((r) => r.status)
        .sort();
      expect(statuses).toEqual([201, 409]);
      const row = await airlineRow(id);
      expect(await exists(fileOf(row!.logoUrl as string))).toBe(true);
      await addLogo(id, mod).expect(409);
      expect(await airlineRow(id)).toMatchObject({
        logoId: row!.logoId,
        logoUrl: row!.logoUrl,
      });
    });

    it('rejects a wrong type, a fake image, a missing file (400) and a file over 5 MB (413)', async () => {
      await addLogo(
        airlineB,
        airlineModB,
        Buffer.from('plain text'),
        'text/plain',
      ).expect(400);
      await addLogo(
        airlineB,
        airlineModB,
        Buffer.from('not really a png'),
        'image/png',
      ).expect(400);
      await http()
        .post(`/api/airlines/${airlineB}/logo`)
        .set('Cookie', airlineModB)
        .expect(400);
      await addLogo(
        airlineB,
        airlineModB,
        Buffer.alloc(IMAGE_MAX_BYTES + 1),
      ).expect(413);
      expect((await airlineRow(airlineB))?.logoUrl).toBeUndefined();
    });

    it('only the moderator of that airline: guest 401, user 403, admin 403, other airline moderator 403, hotel moderator 403', async () => {
      await http()
        .post(`/api/airlines/${airlineB}/logo`)
        .attach('image', png, { filename: 'l', contentType: 'image/png' })
        .expect(401);
      await addLogo(airlineB, user).expect(403);
      await addLogo(airlineB, admin).expect(403);
      await addLogo(airlineB, airlineModA).expect(403);
      await addLogo(airlineB, hotelModA).expect(403);
      await addLogo('not-an-id', airlineModA).expect(403);
      expect((await airlineRow(airlineB))?.logoUrl).toBeUndefined();
    });
  });

  describe('DELETE /api/airlines/:id/logo', () => {
    it('removes the logo and its file, then a new one can be uploaded', async () => {
      const logo = (await addLogo(airlineA, airlineModA).expect(201)).body;
      await removeLogo(airlineA, airlineModA).expect(204);
      expect(await exists(fileOf(logo.url))).toBe(false);
      const row = await airlineRow(airlineA);
      expect(row?.logoId).toBeUndefined();
      expect(row?.logoUrl).toBeUndefined();
      await removeLogo(airlineA, airlineModA).expect(404);
      await addLogo(airlineA, airlineModA).expect(201);
    });

    it("only that airline's moderator can remove it", async () => {
      const logo = (await addLogo(airlineB, airlineModB).expect(201)).body;
      await http().delete(`/api/airlines/${airlineB}/logo`).expect(401);
      await removeLogo(airlineB, airlineModA).expect(403);
      await removeLogo(airlineB, user).expect(403);
      expect(await exists(fileOf(logo.url))).toBe(true);
      expect(await airlineRow(airlineB)).toMatchObject({ logoUrl: logo.url });
    });
  });

  describe('airline body', () => {
    it('logoUrl can no longer be set as a plain URL on create or edit', async () => {
      const edit = await http()
        .patch(`/api/airlines/${airlineA}`)
        .set('Cookie', airlineModA)
        .send({ logoUrl: 'https://example.com/x.png' })
        .expect(400);
      expect(edit.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'logoUrl' })]),
      );
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({
          name: 'Sneaky Air',
          code: 'SX',
          logoUrl: 'https://example.com/x.png',
        })
        .expect(400);
    });
  });
});
