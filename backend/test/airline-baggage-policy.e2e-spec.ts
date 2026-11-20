import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AirlinesModule, AirlinesService } from '../src/airlines';
import { AuthModule } from '../src/auth/auth.module';
import { Role } from '../src/common';
import configuration from '../src/config/configuration';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

describe('airline baggage policy (FLT-08) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());

  async function loginAs(email: string, extra: Record<string, unknown> = {}) {
    await connection.collection('users').insertOne({
      name: 'Seeded',
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.USER,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  let admin: string;
  let user: string;
  let hotelMod: string;
  let modOfA: string;
  let modOfB: string;
  let airlineA: { id: string };
  let airlineB: { id: string };

  const valid = () => ({ extraBagPriceCents: 3000, maxExtraBags: 2 });
  const put = (airlineId: string, cookie: string, body: unknown) =>
    http()
      .put(`/api/airlines/${airlineId}/baggage-policy`)
      .set('Cookie', cookie)
      .send(body as object);

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';

    mongo = await MongoMemoryServer.create();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [configuration],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        AirlinesModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();
    await connection.model('Airline').init();

    admin = await loginAs('admin@example.com', { role: Role.ADMIN });
    user = await loginAs('user@example.com');
    hotelMod = await loginAs('hotel@example.com', {
      role: Role.HOTEL_MODERATOR,
      hotelId: new Types.ObjectId(),
    });
    airlineA = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline A', code: 'AA' })
        .expect(201)
    ).body;
    airlineB = (
      await http()
        .post('/api/airlines')
        .set('Cookie', admin)
        .send({ name: 'Airline B', code: 'BB' })
        .expect(201)
    ).body;
    modOfA = await loginAs('moda@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(airlineA.id),
    });
    modOfB = await loginAs('modb@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: new Types.ObjectId(airlineB.id),
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  afterEach(async () => {
    await connection
      .collection('airlines')
      .updateMany({}, { $unset: { baggagePolicy: '' } });
  });

  it('sets the policy: 200, integer cents, currency, weight rule reminder', async () => {
    const res = await put(airlineA.id, modOfA, valid()).expect(200);
    expect(res.body).toMatchObject({
      airlineId: airlineA.id,
      extraBagPriceCents: 3000,
      currency: 'USD',
      maxExtraBags: 2,
    });
    expect(res.body.extraBagWeightRule).toContain('maxBagWeightKg');
    const stored = await connection
      .collection('airlines')
      .findOne({ _id: new Types.ObjectId(airlineA.id) });
    expect(stored!.baggagePolicy).toEqual({
      extraBagPriceCents: 3000,
      maxExtraBags: 2,
    });
  });

  it('accepts a max of 0 (no extra bags offered)', async () => {
    const res = await put(airlineA.id, modOfA, {
      extraBagPriceCents: 3000,
      maxExtraBags: 0,
    }).expect(200);
    expect(res.body.maxExtraBags).toBe(0);
  });

  it('PUT replaces the whole policy and can be repeated', async () => {
    await put(airlineA.id, modOfA, valid()).expect(200);
    const res = await put(airlineA.id, modOfA, {
      extraBagPriceCents: 4500,
      maxExtraBags: 1,
    }).expect(200);
    expect(res.body).toMatchObject({
      extraBagPriceCents: 4500,
      maxExtraBags: 1,
    });
  });

  it.each([
    ['price 0', { extraBagPriceCents: 0 }, 'extraBagPriceCents'],
    ['negative price', { extraBagPriceCents: -500 }, 'extraBagPriceCents'],
    ['fractional cents', { extraBagPriceCents: 10.5 }, 'extraBagPriceCents'],
    ['price as text', { extraBagPriceCents: '3000' }, 'extraBagPriceCents'],
    ['negative max bags', { maxExtraBags: -1 }, 'maxExtraBags'],
    ['fractional max bags', { maxExtraBags: 1.5 }, 'maxExtraBags'],
    ['max bags as text', { maxExtraBags: '2' }, 'maxExtraBags'],
    ['max bags above the cap', { maxExtraBags: 11 }, 'maxExtraBags'],
  ])('rejects %s with a field-level 400', async (_label, override, field) => {
    const res = await put(airlineA.id, modOfA, {
      ...valid(),
      ...override,
    }).expect(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
    expect(
      (await connection.collection('airlines').findOne({
        _id: new Types.ObjectId(airlineA.id),
      }))!.baggagePolicy,
    ).toBeUndefined();
  });

  it('rejects missing and unknown fields (a PUT needs both values)', async () => {
    const res = await put(airlineA.id, modOfA, {}).expect(400);
    expect(res.body.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(['extraBagPriceCents', 'maxExtraBags']),
    );
    await put(airlineA.id, modOfA, { extraBagPriceCents: 3000 }).expect(400);
    await put(airlineA.id, modOfA, { ...valid(), extraBagWeightKg: 30 }).expect(
      400,
    );
    await put(airlineA.id, modOfA, {
      ...valid(),
      airlineId: airlineB.id,
    }).expect(400);
  });

  it("another airline's moderator gets 403 and nothing changes", async () => {
    await put(airlineA.id, modOfB, valid()).expect(403);
    expect(
      (await connection.collection('airlines').findOne({
        _id: new Types.ObjectId(airlineA.id),
      }))!.baggagePolicy,
    ).toBeUndefined();
  });

  it('each moderator sets only their own policy', async () => {
    await put(airlineA.id, modOfA, valid()).expect(200);
    await put(airlineB.id, modOfB, {
      extraBagPriceCents: 999,
      maxExtraBags: 3,
    }).expect(200);
    const a = await connection
      .collection('airlines')
      .findOne({ _id: new Types.ObjectId(airlineA.id) });
    expect(a!.baggagePolicy.extraBagPriceCents).toBe(3000);
  });

  it.each([
    ['user', () => user],
    ['admin', () => admin],
    ['hotel moderator', () => hotelMod],
  ])('%s gets 403', async (_name, cookie) => {
    await put(airlineA.id, cookie(), valid()).expect(403);
  });

  it('not logged in: 401', async () => {
    await http()
      .put(`/api/airlines/${airlineA.id}/baggage-policy`)
      .send(valid())
      .expect(401);
  });

  it('malformed airline id is 400', async () => {
    await put('not-an-id', modOfA, valid()).expect(400);
  });

  it('a moderator whose airline no longer exists gets 404', async () => {
    const ghostId = new Types.ObjectId();
    const ghostMod = await loginAs('ghost@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: ghostId,
    });
    await put(ghostId.toString(), ghostMod, valid()).expect(404);
  });

  it('the profile endpoints do not leak or reset the policy', async () => {
    await put(airlineA.id, modOfA, valid()).expect(200);
    const profile = await http()
      .patch(`/api/airlines/${airlineA.id}`)
      .set('Cookie', modOfA)
      .send({ name: 'Airline A Renamed' })
      .expect(200);
    expect(profile.body.baggagePolicy).toBeUndefined();
    expect(
      (await connection.collection('airlines').findOne({
        _id: new Types.ObjectId(airlineA.id),
      }))!.baggagePolicy,
    ).toEqual({ extraBagPriceCents: 3000, maxExtraBags: 2 });
  });

  describe('AirlinesService.getBaggagePolicy (for FLT-19 and PAY-02)', () => {
    it('returns the policy once set, null before', async () => {
      const service = app.get(AirlinesService);
      expect(await service.getBaggagePolicy(airlineA.id)).toBeNull();
      await put(airlineA.id, modOfA, valid()).expect(200);
      expect(await service.getBaggagePolicy(airlineA.id)).toMatchObject({
        airlineId: airlineA.id,
        extraBagPriceCents: 3000,
        maxExtraBags: 2,
      });
      expect(await service.getBaggagePolicy('not-an-id')).toBeNull();
    });
  });
});
