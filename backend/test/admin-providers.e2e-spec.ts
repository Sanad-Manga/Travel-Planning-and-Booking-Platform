import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AccountStatus, Role } from '../src/common';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { buildSwaggerDocument, setupApp } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

describe('ACC-13 / ACC-15 admin provider list', () => {
  const url = '/api/admin/providers';
  const secret = 'provider-list-test-access-0123456789abcdef';
  const keys = [
    'MONGODB_URI',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'COOKIE_SECURE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const cookies = new Map<Role, string>();
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let db: Connection;
  let root: string;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    root = await mkdtemp(join(tmpdir(), 'provider-list-e2e-'));
    Object.assign(process.env, {
      MONGODB_URI: mongo.getUri(),
      JWT_ACCESS_SECRET: secret,
      JWT_REFRESH_SECRET: 'provider-list-test-refresh-0123456789abcdef',
      COOKIE_SECURE: 'false',
    });
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const configSpy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        configure({ ...options, ignoreEnvFile: true }),
      );
    const { AppModule } = await import('../src/app.module');
    configSpy.mockRestore();

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UPLOAD_OPTIONS)
      .useValue({
        root,
        leaseMs: 60_000,
        recoveryIntervalMs: 3_600_000,
        recoveryBatchSize: 50,
      })
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    setupApp(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());

    const users = Object.values(Role).map((role) => ({
      _id: new Types.ObjectId(),
      name: role,
      email: `${role.toLowerCase()}@example.test`,
      passwordHash: 'test-only-password-hash',
      role,
      status: AccountStatus.ACTIVE,
    }));
    await db.collection('users').insertMany(users);
    const jwt = new JwtService({ secret });
    for (const { _id, role } of users) {
      const token = jwt.sign(
        { sub: _id.toHexString(), role },
        { expiresIn: '15m' },
      );
      cookies.set(role, `access_token=${token}`);
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    if (root) await rm(root, { recursive: true, force: true });
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const http = () => request(app.getHttpServer());
  const list = (query: Record<string, unknown>, role = Role.ADMIN) =>
    http()
      .get(url)
      .query(query)
      .set('Cookie', cookies.get(role) ?? '');

  it.each(['airline', 'hotel'])(
    'returns an empty %s collection as a page',
    async (type) => {
      const { body } = await list({ type }).expect(200);
      expect(body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    },
  );

  describe('with airlines and hotels', () => {
    const airlines = Array.from({ length: 13 }, (_, index) => ({
      _id: new Types.ObjectId((index + 1).toString(16).padStart(24, '0')),
      name: `Airline ${13 - index}`,
      code: `Z${index.toString(36).toUpperCase()}`,
      isActive: index % 2 === 0,
      logoUrl: '/uploads/test-airline.png',
    }));
    const hotels = [true, false].map((isActive, index) => ({
      _id: new Types.ObjectId((index + 1).toString(16).padStart(24, '1')),
      name: `Hotel ${index}`,
      nameKey: `hotel ${index}`,
      cityId: 'fixture-city',
      isActive,
      address: 'Fixture address',
    }));
    const items = (providers: typeof airlines | typeof hotels) =>
      providers.map(({ _id, name, isActive }) => ({
        id: _id.toHexString(),
        name,
        isActive,
      }));

    beforeAll(async () => {
      await db.collection('airlines').insertMany([...airlines].reverse());
      await db.collection('hotels').insertMany([...hotels].reverse());
    });

    it('returns the first ten airlines in ID order and only the public response fields', async () => {
      const { body } = await list({ type: 'airline' }).expect(200);
      expect(body).toEqual({
        items: items(airlines.slice(0, 10)),
        page: 1,
        limit: 10,
        total: 13,
        totalPages: 2,
      });
    });

    it('returns active and inactive hotels with no airline rows or mutations', async () => {
      const stored = () =>
        db.collection('hotels').find().sort({ _id: 1 }).toArray();
      const before = await stored();
      const { body } = await list({ type: 'hotel' }).expect(200);
      expect(body).toEqual({
        items: items(hotels),
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      expect(await stored()).toEqual(before);
    });

    it('returns disjoint custom pages, supports limit 50, and returns no items past the end', async () => {
      const first = await list({ type: 'airline', page: 1, limit: 8 }).expect(
        200,
      );
      const second = await list({ type: 'airline', page: 2, limit: 8 }).expect(
        200,
      );
      expect(second.body).toEqual({
        items: items(airlines.slice(8)),
        page: 2,
        limit: 8,
        total: 13,
        totalPages: 2,
      });
      expect([...first.body.items, ...second.body.items]).toEqual(
        items(airlines),
      );
      const maximum = await list({ type: 'airline', limit: 50 }).expect(200);
      expect(maximum.body).toEqual({
        items: items(airlines),
        page: 1,
        limit: 50,
        total: 13,
        totalPages: 1,
      });
      const pastEnd = await list({ type: 'airline', page: 3, limit: 8 }).expect(
        200,
      );
      expect(pastEnd.body).toEqual({
        items: [],
        page: 3,
        limit: 8,
        total: 13,
        totalPages: 2,
      });
    });
  });

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'rejects the authenticated %s role',
    async (role) => {
      await list({ type: 'hotel' }, role).expect(403);
    },
  );

  it('rejects an anonymous caller', async () => {
    await http().get(url).query({ type: 'hotel' }).expect(401);
  });

  it.each([
    [{}, 'type'],
    [{ type: 'train' }, 'type'],
    [{ type: 'AIRLINE' }, 'type'],
    [{ type: ['hotel', 'airline'] }, 'type'],
    [{ type: 'hotel', active: 'true' }, 'active'],
    [{ type: 'hotel', page: 0 }, 'page'],
    [{ type: 'hotel', page: 1.5 }, 'page'],
    [{ type: 'hotel', limit: 0 }, 'limit'],
    [{ type: 'hotel', limit: 51 }, 'limit'],
  ])('validates %j with the shared error envelope', async (query, field) => {
    const res = await list(query).expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: [
        expect.objectContaining({ field, message: expect.any(String) }),
      ],
      path: url,
      timestamp: expect.any(String),
    });
  });

  it('sanitizes database failures', async () => {
    const find = jest
      .spyOn(db.model<Hotel>(Hotel.name), 'find')
      .mockImplementationOnce(() => {
        throw new Error('synthetic private driver details');
      });
    try {
      const res = await list({ type: 'hotel' }).expect(500);
      expect(res.body).toMatchObject({
        statusCode: 500,
        message: 'Providers could not be retrieved',
      });
      expect(res.text).not.toContain('synthetic private driver details');
    } finally {
      find.mockRestore();
    }
  });

  it('documents cookie security, the type and pagination parameters, the item DTO, and errors', () => {
    const doc = buildSwaggerDocument(app);
    const op = doc.paths[url].get!;
    expect(op.tags).toContain('admin');
    expect(op.summary).toContain('ADMIN only');
    expect(op.security).toEqual([{ cookie: [] }]);
    expect(op.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'type',
          in: 'query',
          required: true,
          schema: expect.objectContaining({ enum: ['hotel', 'airline'] }),
        }),
        expect.objectContaining({
          name: 'page',
          schema: expect.objectContaining({ default: 1, minimum: 1 }),
        }),
        expect.objectContaining({
          name: 'limit',
          schema: expect.objectContaining({
            default: 10,
            minimum: 1,
            maximum: 50,
          }),
        }),
      ]),
    );
    expect(Object.keys(op.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '500',
    ]);
    expect(op.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['items', 'page', 'limit', 'total', 'totalPages'],
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/ProviderListItemDto' },
              },
            },
          },
        },
      },
    });
    expect(doc.components?.schemas?.ProviderListItemDto).toMatchObject({
      required: ['id', 'name', 'isActive'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        isActive: { type: 'boolean' },
      },
    });
  });
});
