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
import { RefundCalculator } from '../src/payments/refund-calculator';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

describe('airline cancellation policy (FLT-09) over HTTP (e2e)', () => {
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

  const tiers = () => ({
    cancellationTiers: [
      { daysBeforeThreshold: 7, refundPercent: 50 },
      { daysBeforeThreshold: 14, refundPercent: 100 },
      { daysBeforeThreshold: 0, refundPercent: 0 },
    ],
  });
  const put = (airlineId: string, cookie: string, body: unknown) =>
    http()
      .put(`/api/airlines/${airlineId}/cancellation-policy`)
      .set('Cookie', cookie)
      .send(body as object);
  const stored = async (id: string) =>
    (await connection
      .collection('airlines')
      .findOne({ _id: new Types.ObjectId(id) }))!;

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
      .updateMany({}, { $unset: { cancellationTiers: '' } });
  });

  it('sets the tiers: 200, returned largest threshold first, stored with the airline', async () => {
    const res = await put(airlineA.id, modOfA, tiers()).expect(200);
    expect(res.body).toEqual({
      airlineId: airlineA.id,
      cancellationTiers: [
        { daysBeforeThreshold: 14, refundPercent: 100 },
        { daysBeforeThreshold: 7, refundPercent: 50 },
        { daysBeforeThreshold: 0, refundPercent: 0 },
      ],
    });
    expect((await stored(airlineA.id)).cancellationTiers).toHaveLength(3);
  });

  it('PUT replaces the whole list; [] means no refunds and is accepted', async () => {
    await put(airlineA.id, modOfA, tiers()).expect(200);
    const replaced = await put(airlineA.id, modOfA, {
      cancellationTiers: [{ daysBeforeThreshold: 3, refundPercent: 25 }],
    }).expect(200);
    expect(replaced.body.cancellationTiers).toEqual([
      { daysBeforeThreshold: 3, refundPercent: 25 },
    ]);
    const cleared = await put(airlineA.id, modOfA, {
      cancellationTiers: [],
    }).expect(200);
    expect(cleared.body.cancellationTiers).toEqual([]);
  });

  it('accepts the boundaries: threshold 0 and 365, refund 0 and 100', async () => {
    await put(airlineA.id, modOfA, {
      cancellationTiers: [
        { daysBeforeThreshold: 0, refundPercent: 0 },
        { daysBeforeThreshold: 365, refundPercent: 100 },
      ],
    }).expect(200);
  });

  it.each([
    [
      'negative threshold',
      { daysBeforeThreshold: -1, refundPercent: 50 },
      'cancellationTiers.0.daysBeforeThreshold',
    ],
    [
      'fractional threshold',
      { daysBeforeThreshold: 1.5, refundPercent: 50 },
      'cancellationTiers.0.daysBeforeThreshold',
    ],
    [
      'threshold as text',
      { daysBeforeThreshold: '7', refundPercent: 50 },
      'cancellationTiers.0.daysBeforeThreshold',
    ],
    [
      'threshold above 365',
      { daysBeforeThreshold: 366, refundPercent: 50 },
      'cancellationTiers.0.daysBeforeThreshold',
    ],
    [
      'refund below 0',
      { daysBeforeThreshold: 7, refundPercent: -1 },
      'cancellationTiers.0.refundPercent',
    ],
    [
      'refund above 100',
      { daysBeforeThreshold: 7, refundPercent: 101 },
      'cancellationTiers.0.refundPercent',
    ],
    [
      'fractional refund',
      { daysBeforeThreshold: 7, refundPercent: 12.5 },
      'cancellationTiers.0.refundPercent',
    ],
    [
      'missing refund',
      { daysBeforeThreshold: 7 },
      'cancellationTiers.0.refundPercent',
    ],
    [
      'unknown tier field',
      { daysBeforeThreshold: 7, refundPercent: 50, note: 'x' },
      'cancellationTiers.0.note',
    ],
  ])(
    'rejects %s with a field-level 400 and stores nothing',
    async (_label, tier, field) => {
      const res = await put(airlineA.id, modOfA, {
        cancellationTiers: [tier],
      }).expect(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
      expect((await stored(airlineA.id)).cancellationTiers).toBeUndefined();
    },
  );

  it('rejects duplicate thresholds with a field-level 400 naming the repeated tier', async () => {
    const res = await put(airlineA.id, modOfA, {
      cancellationTiers: [
        { daysBeforeThreshold: 7, refundPercent: 100 },
        { daysBeforeThreshold: 3, refundPercent: 50 },
        { daysBeforeThreshold: 7, refundPercent: 25 },
      ],
    }).expect(400);
    expect(res.body.details).toEqual([
      expect.objectContaining({
        field: 'cancellationTiers.2.daysBeforeThreshold',
      }),
    ]);
    expect((await stored(airlineA.id)).cancellationTiers).toBeUndefined();
  });

  it('rejects a missing or non-array list, more than 20 tiers, and unknown body fields', async () => {
    await put(airlineA.id, modOfA, {}).expect(400);
    await put(airlineA.id, modOfA, { cancellationTiers: 'none' }).expect(400);
    await put(airlineA.id, modOfA, { cancellationTiers: null }).expect(400);
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      daysBeforeThreshold: i,
      refundPercent: 10,
    }));
    await put(airlineA.id, modOfA, { cancellationTiers: tooMany }).expect(400);
    await put(airlineA.id, modOfA, {
      ...tiers(),
      airlineId: airlineB.id,
    }).expect(400);
  });

  it("another airline's moderator gets 403 and nothing changes", async () => {
    await put(airlineA.id, modOfB, tiers()).expect(403);
    expect((await stored(airlineA.id)).cancellationTiers).toBeUndefined();
  });

  it('each moderator sets only their own tiers', async () => {
    await put(airlineA.id, modOfA, tiers()).expect(200);
    await put(airlineB.id, modOfB, {
      cancellationTiers: [{ daysBeforeThreshold: 1, refundPercent: 10 }],
    }).expect(200);
    expect((await stored(airlineA.id)).cancellationTiers).toHaveLength(3);
    expect((await stored(airlineB.id)).cancellationTiers).toHaveLength(1);
  });

  it.each([
    ['user', () => user],
    ['admin', () => admin],
    ['hotel moderator', () => hotelMod],
  ])('%s gets 403', async (_name, cookie) => {
    await put(airlineA.id, cookie(), tiers()).expect(403);
  });

  it('not logged in: 401; malformed id 400; deleted airline 404', async () => {
    await http()
      .put(`/api/airlines/${airlineA.id}/cancellation-policy`)
      .send(tiers())
      .expect(401);
    await put('not-an-id', modOfA, tiers()).expect(400);
    const ghost = new Types.ObjectId();
    const ghostMod = await loginAs('ghost@example.com', {
      role: Role.AIRLINE_MODERATOR,
      airlineId: ghost,
    });
    await put(ghost.toString(), ghostMod, tiers()).expect(404);
  });

  it('saving the cancellation policy does not touch the baggage policy, and the profile edit does not touch the tiers', async () => {
    await put(`${airlineA.id}`, modOfA, tiers()).expect(200);
    await http()
      .put(`/api/airlines/${airlineA.id}/baggage-policy`)
      .set('Cookie', modOfA)
      .send({ extraBagPriceCents: 3000, maxExtraBags: 2 })
      .expect(200);
    await put(airlineA.id, modOfA, {
      cancellationTiers: [{ daysBeforeThreshold: 2, refundPercent: 20 }],
    }).expect(200);
    await http()
      .patch(`/api/airlines/${airlineA.id}`)
      .set('Cookie', modOfA)
      .send({ name: 'Airline A Renamed' })
      .expect(200);
    const doc = await stored(airlineA.id);
    expect(doc.baggagePolicy).toEqual({
      extraBagPriceCents: 3000,
      maxExtraBags: 2,
    });
    expect(doc.cancellationTiers).toEqual([
      { daysBeforeThreshold: 2, refundPercent: 20 },
    ]);
  });

  describe('AirlinesService.getCancellationTiers (for FLT-26, PAY-02, PAY-03, FLT-17)', () => {
    it('returns [] before tiers are set, sorted tiers after, 404 for an unknown or malformed id', async () => {
      const service = app.get(AirlinesService);
      expect(await service.getCancellationTiers(airlineA.id)).toEqual([]);
      await put(airlineA.id, modOfA, tiers()).expect(200);
      expect(await service.getCancellationTiers(airlineA.id)).toEqual([
        { daysBeforeThreshold: 14, refundPercent: 100 },
        { daysBeforeThreshold: 7, refundPercent: 50 },
        { daysBeforeThreshold: 0, refundPercent: 0 },
      ]);
      await expect(
        service.getCancellationTiers(new Types.ObjectId().toString()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.getCancellationTiers('nope')).rejects.toMatchObject({
        status: 404,
      });
    });

    it("feeds Payments' RefundCalculator unchanged (the tier shape matches)", async () => {
      const service = app.get(AirlinesService);
      await put(airlineA.id, modOfA, tiers()).expect(200);
      const t = await service.getCancellationTiers(airlineA.id);
      // 20 days before: highest threshold not above 20 is 14 -> 100 % of 20000
      expect(
        RefundCalculator.compute({
          tiers: t,
          daysBefore: 20,
          totalCents: 20000,
        }),
      ).toBe(20000);
      // 8 days: threshold 7 -> 50 %
      expect(
        RefundCalculator.compute({
          tiers: t,
          daysBefore: 8,
          totalCents: 20000,
        }),
      ).toBe(10000);
      // 3 days: threshold 0 -> 0 %
      expect(
        RefundCalculator.compute({
          tiers: t,
          daysBefore: 3,
          totalCents: 20000,
        }),
      ).toBe(0);
    });
  });
});
