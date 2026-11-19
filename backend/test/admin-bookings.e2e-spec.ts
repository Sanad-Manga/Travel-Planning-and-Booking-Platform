import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AccountStatus, BookingStatus, BookingType, Role } from '../src/common';
import { FlightBooking } from '../src/flights/schemas/flight-booking.schema';
import { setupApp, setupSwagger } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

const route = '/api/admin/bookings';
const oid = () => new Types.ObjectId();
const access = 'acc17-fixture-access-0123456789abcdef';
const settings = {
  MONGODB_URI: '',
  JWT_ACCESS_SECRET: access,
  JWT_REFRESH_SECRET: 'acc17-fixture-refresh-0123456789abcdef',
  COOKIE_SECURE: 'false',
};
const previous = Object.keys(settings).map(
  (key) => [key, process.env[key]] as const,
);
const states = Object.values(BookingStatus);
const type = BookingType;
const userId = oid();
const airlineId = oid();
const hotelId = oid();
const outboundId = oid();
const returnId = oid();
const missingFlightId = oid();
const missingProviderId = oid();
const missingUserId = oid();
const outbound = {
  _id: outboundId,
  departureAt: new Date('2031-02-01T01:00Z'),
  arrivalAt: new Date('2031-02-01T04:00Z'),
};
const inbound = {
  _id: returnId,
  departureAt: new Date('2031-02-05T12:00Z'),
  arrivalAt: new Date('2031-02-05T15:00Z'),
};
const fixture = Array.from({ length: 30 }, (_, i) => ({
  _id: oid(),
  type: i % 2 === 0 ? type.FLIGHT : type.HOTEL,
  userId: i === 4 ? missingUserId : userId,
  providerId: i === 4 ? missingProviderId : i % 2 === 0 ? airlineId : hotelId,
  bookingReference: i % 3 === 0 ? undefined : 'BOOK-' + i,
  createdAt:
    i === 0
      ? new Date('2026-11-01T23:59:59.999Z')
      : i === 1
        ? new Date('2026-11-02T00:00:00.000Z')
        : i === 9
          ? new Date('2026-11-02T23:59:59.999Z')
          : i === 10
            ? new Date('2026-11-03T00:00:00.000Z')
            : new Date(
                Date.UTC(
                  2026,
                  10,
                  2 + Math.floor(i / 10),
                  0,
                  Math.floor(i / 4),
                ),
              ),
  totalCents: 12340 + i,
  currency: i % 2 === 0 ? 'USD' : 'EUR',
  status: states[Math.floor(i / 2) % states.length],
}));
const ordered = [...fixture].sort(
  (a, b) =>
    b.createdAt.getTime() - a.createdAt.getTime() ||
    a.type.localeCompare(b.type) ||
    String(b._id).localeCompare(String(a._id)),
);
const fields = [
  'id',
  'type',
  'bookingReference',
  'user',
  'provider',
  'startDate',
  'endDate',
  'totalCents',
  'currency',
  'status',
  'createdAt',
].sort();
const key = (row: { type: BookingType; id: string }) => row.type + ':' + row.id;
const keys = (items: Array<{ type: BookingType; id: string }>) =>
  items.map(key);
const expectedKeys = (items: typeof fixture) =>
  keys(items.map((item) => ({ type: item.type, id: String(item._id) })));
const sign = (id: Types.ObjectId, role: Role, expiresIn = 900) =>
  'access_token=' +
  new JwtService().sign(
    { sub: String(id), role },
    { secret: access, expiresIn },
  );

describe('ACC-17 bookings in the real AppModule', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let root: string;
  let db: Connection;
  const cookies = new Map<Role, string>();
  let adminId: Types.ObjectId;
  const http = () => request(app.getHttpServer());
  const list = (query: Record<string, unknown> = {}) =>
    http().get(route).set('Cookie', cookies.get(Role.ADMIN)!).query(query);
  const assertPage = async (
    query: Record<string, unknown>,
    rows: typeof fixture,
    page = 1,
    limit = 10,
  ) => {
    const response = await list(query).expect(200);
    expect(response.body).toEqual({
      items: expect.any(Array),
      page,
      limit,
      total: rows.length,
      totalPages: Math.ceil(rows.length / limit),
    });
    expect(keys(response.body.items)).toEqual(
      expectedKeys(rows.slice((page - 1) * limit, page * limit)),
    );
    return response.body.items as Array<Record<string, unknown>>;
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'acc17-e2e-'));
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, settings, { MONGODB_URI: mongo.getUri() });
    const configure = ConfigModule.forRoot.bind(ConfigModule);
    const spy = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockImplementation((options) =>
        configure({ ...options, ignoreEnvFile: true }),
      );
    try {
      const { AppModule } = await import('../src/app.module');
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(UPLOAD_OPTIONS)
        .useValue({
          root,
          leaseMs: 60000,
          recoveryIntervalMs: 3600000,
          recoveryBatchSize: 50,
        })
        .compile();
      app = moduleRef.createNestApplication();
      app.useLogger(false);
      setupApp(app);
      setupSwagger(app);
      await app.listen(0, '127.0.0.1');
    } finally {
      spy.mockRestore();
    }

    db = app.get<Connection>(getConnectionToken());
    for (const role of Object.values(Role)) {
      const id = role === Role.USER ? userId : oid();
      if (role === Role.ADMIN) adminId = id;
      await db.collection('users').insertOne({
        _id: id,
        name: 'Fixture ' + role,
        role,
        status: AccountStatus.ACTIVE,
        email: role.toLowerCase() + '@example.test',
        passwordHash: 'fixture-secret-account',
      });
      cookies.set(role, sign(id, role));
    }
    await db
      .collection('airlines')
      .insertOne({ _id: airlineId, name: 'Fixture Airline', code: 'FA' });
    await db.collection('hotels').insertOne({
      _id: hotelId,
      name: 'Fixture Hotel',
      nameKey: 'fixture hotel',
    });
    await db.collection('flights').insertMany([
      {
        ...outbound,
        airlineId,
        flightNumber: 'FA100',
        departureLocalDate: '2031-02-01',
        cabinCategories: [{ availableSeats: 12, bookedSeats: 3 }],
      },
      {
        ...inbound,
        airlineId,
        flightNumber: 'FA101',
        departureLocalDate: '2031-02-05',
      },
    ]);
    const roomId = oid();
    await db.collection('rooms').insertOne({
      _id: roomId,
      hotelId,
      nameKey: 'fixture room',
      availability: [],
    });
    await db.collection('payments').insertOne({
      _id: oid(),
      stripePaymentIntentId: 'fixture-secret-intent',
      status: 'SUCCEEDED',
    });

    const stored = ({
      _id,
      userId,
      bookingReference,
      totalCents,
      currency,
      status,
      createdAt,
    }: (typeof fixture)[number]) => ({
      _id,
      userId,
      ...(bookingReference && { bookingReference }),
      totalCents,
      currency,
      status,
      createdAt,
      paymentRef: 'fixture-secret-payment',
    });

    await db.collection('flightBookings').insertMany(
      fixture
        .filter((row) => row.type === type.FLIGHT)
        .map((row) => ({
          ...stored(row),
          airlineId: row.providerId,
          flightId: row === fixture[4] ? missingFlightId : outboundId,
          ...(row === fixture[2] && {
            segments: [{ flightId: outboundId }, { flightId: returnId }],
          }),
          ...(row === fixture[6] && {
            segments: [{ flightId: outboundId }, { flightId: missingFlightId }],
          }),
          passengers: [
            {
              fullName: 'fixture-secret-passenger',
              passportOrIdNumber: 'fixture-secret-passport',
            },
          ],
        })),
    );
    await db.collection('hotelBookings').insertMany(
      fixture
        .filter((row) => row.type === type.HOTEL)
        .map((row) => ({
          ...stored(row),
          hotelId: row.providerId,
          checkIn: '2032-06-01',
          checkOut: '2032-06-05',
          rooms: [{ roomId }],
        })),
    );
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

  it('rejects anonymous, invalid and expired sessions', async () => {
    await http().get(route).expect(401);
    await http().get(route).set('Cookie', 'access_token=invalid').expect(401);
    await http()
      .get(route)
      .set('Cookie', sign(adminId, Role.ADMIN, -1))
      .expect(401);
  });

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'denies authenticated %s',
    async (role) => {
      await http().get(route).set('Cookie', cookies.get(role)!).expect(403);
    },
  );

  it.each([AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED])(
    'denies an admin with status %s',
    async (status) => {
      const id = oid();
      await db.collection('users').insertOne({
        _id: id,
        role: Role.ADMIN,
        email: status.toLowerCase() + '@example.test',
        status,
      });
      await http().get(route).set('Cookie', sign(id, Role.ADMIN)).expect(401);
    },
  );

  it('returns one stable 10-item page and correct global totals across timestamp ties', async () => {
    const first = await assertPage({}, ordered);
    const second = await assertPage({ page: 2 }, ordered, 2);
    const third = await assertPage({ page: 3 }, ordered, 3);
    expect(
      new Set([...first, ...second, ...third].map((item) => item.id)).size,
    ).toBe(30);
    await assertPage({ page: 2 }, ordered, 2);
  });

  it('handles custom and maximum limits and out-of-range pages', async () => {
    await assertPage({ page: 2, limit: 7 }, ordered, 2, 7);
    await assertPage({ limit: 50 }, ordered, 1, 50);
    await assertPage({ page: 4 }, ordered, 4);
  });

  it('returns the same exact response keys and correct amounts, parties, references and dates for both types', async () => {
    const items = await assertPage({ limit: 50 }, ordered, 1, 50);
    for (const [index, item] of items.entries()) {
      const row = ordered[index];
      const flight = row.type === type.FLIGHT;
      expect(Object.keys(item).sort()).toEqual(fields);
      expect(item).toEqual({
        id: String(row._id),
        type: row.type,
        bookingReference: row.bookingReference ?? null,
        user: {
          id: String(row.userId),
          name: row === fixture[4] ? null : 'Fixture USER',
        },
        provider: {
          id: String(row.providerId),
          name:
            row === fixture[4]
              ? null
              : flight
                ? 'Fixture Airline'
                : 'Fixture Hotel',
        },
        startDate: flight
          ? row === fixture[4]
            ? null
            : outbound.departureAt.toISOString()
          : '2032-06-01',
        endDate: flight
          ? row === fixture[4] || row === fixture[6]
            ? null
            : row === fixture[2]
              ? inbound.arrivalAt.toISOString()
              : outbound.arrivalAt.toISOString()
          : '2032-06-05',
        totalCents: row.totalCents,
        currency: row.currency,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      });
    }
  });

  it.each(Object.values(type))(
    'filters %s globally before paging',
    async (kind) => {
      await assertPage(
        { type: kind, page: 2 },
        ordered.filter((row) => row.type === kind),
        2,
      );
    },
  );

  it.each(states)('filters %s for both types', async (status) => {
    await assertPage(
      { status },
      ordered.filter((row) => row.status === status),
    );
  });

  const from = new Date('2026-11-02T00:00:00.000Z');
  const end = new Date('2026-11-03T00:00:00.000Z');
  const inRange = (row: (typeof fixture)[number]) =>
    row.createdAt >= from && row.createdAt < end;
  const confirmed = (row: (typeof fixture)[number]) =>
    row.status === BookingStatus.CONFIRMED;
  const flight = (row: (typeof fixture)[number]) => row.type === type.FLIGHT;

  it('interprets both single and combined date bounds as inclusive UTC creation days', async () => {
    await assertPage(
      { dateFrom: '2026-11-02' },
      ordered.filter((row) => row.createdAt >= from),
    );
    await assertPage(
      { dateTo: '2026-11-02' },
      ordered.filter((row) => row.createdAt < end),
    );
    await assertPage(
      { dateFrom: '2026-11-02', dateTo: '2026-11-02' },
      ordered.filter(inRange),
    );
    await assertPage({ dateFrom: '2026-11-01', dateTo: '2026-11-01' }, [
      fixture[0],
    ]);
    await assertPage({ dateFrom: '2030-01-01' }, []);
  });

  it('combines each filter pair and all three with correct totals and page boundaries', async () => {
    const range = { dateFrom: '2026-11-02', dateTo: '2026-11-02' };
    await assertPage(
      { type: type.FLIGHT, status: BookingStatus.CONFIRMED },
      ordered.filter(flight).filter(confirmed),
    );
    await assertPage(
      { type: type.FLIGHT, ...range },
      ordered.filter(flight).filter(inRange),
    );
    await assertPage(
      { status: BookingStatus.CONFIRMED, ...range },
      ordered.filter(confirmed).filter(inRange),
    );
    await assertPage(
      {
        type: type.FLIGHT,
        status: BookingStatus.CONFIRMED,
        ...range,
        dateTo: '2026-11-03',
        page: 2,
        limit: 1,
      },
      ordered
        .filter(flight)
        .filter(confirmed)
        .filter(
          (row) =>
            row.createdAt >= from && row.createdAt < new Date('2026-11-04'),
        ),
      2,
      1,
    );
  });

  it.each([
    ['page', { page: 0 }],
    ['page', { page: 'not-a-number' }],
    ['page', { page: 1.5 }],
    ['page', { page: 1e40 }],
    ['page', { page: [1, 2] }],
    ['limit', { limit: 0 }],
    ['limit', { limit: 51 }],
    ['type', { type: 'CAR' }],
    ['status', { status: 'UNKNOWN' }],
    ['dateFrom', { dateFrom: '2026-11-01T00:00:00Z' }],
    ['dateTo', { dateTo: '2026-02-30' }],
    ['dateTo', { dateFrom: '2026-11-05', dateTo: '2026-11-04' }],
    ['sort', { sort: 'price' }],
    ['status[$ne]', { 'status[$ne]': 'PENDING_PAYMENT' }],
  ])('returns standard details for invalid %s (%j)', async (field, invalid) => {
    const response = await list(invalid).expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      path: route,
      details: expect.arrayContaining([
        expect.objectContaining({ field, message: expect.any(String) }),
      ]),
    });
  });

  it('does not write bookings, inventory or payments and excludes private fields', async () => {
    const collections = [
      'flightBookings',
      'hotelBookings',
      'flights',
      'rooms',
      'payments',
    ];
    const snapshot = async () =>
      Promise.all(
        collections.map((name) =>
          db.collection(name).find({}).sort({ _id: 1 }).toArray(),
        ),
      );
    const before = await snapshot();
    const response = await list({ limit: 50 }).expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(
      /fixture-secret|passport|passwordHash|paymentRef|stripePaymentIntentId|passengers/,
    );
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const client = http();
      await client[method](route)
        .set('Cookie', cookies.get(Role.ADMIN)!)
        .expect(404);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('returns an empty envelope when both collections are empty', async () => {
    const flights = db.collection('flightBookings');
    const hotels = db.collection('hotelBookings');
    const snapshots = await Promise.all([
      flights.find({}).toArray(),
      hotels.find({}).toArray(),
    ]);
    try {
      await flights.deleteMany({});
      await assertPage(
        {},
        ordered.filter((row) => row.type === type.HOTEL),
      );
      await hotels.deleteMany({});
      await assertPage({}, []);
      await assertPage({ type: type.HOTEL }, []);
    } finally {
      await Promise.all([
        flights.insertMany(snapshots[0]),
        hotels.insertMany(snapshots[1]),
      ]);
    }
  });

  it('returns a standard sanitized 500 for aggregation failure', async () => {
    const model = db.model(FlightBooking.name);
    jest.spyOn(model, 'aggregate').mockImplementationOnce(() => {
      throw new Error('fixture-secret-driver-details');
    });
    const response = await list().expect(500);
    expect(response.body).toMatchObject({
      statusCode: 500,
      message: 'Bookings could not be retrieved',
      path: route,
    });
    expect(JSON.stringify(response.body)).not.toContain('fixture-secret');
  });

  it('documents only GET with cookie auth, pagination, typed filters, unified schema and errors', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const path = response.body.paths[route];
    expect(Object.keys(path)).toEqual(['get']);
    const operation = path.get;
    expect(operation.security).toContainEqual({ cookie: [] });
    const parameters = Object.fromEntries(
      operation.parameters.map((parameter: { name: string }) => [
        parameter.name,
        parameter,
      ]),
    );
    expect(Object.keys(parameters).sort()).toEqual([
      'dateFrom',
      'dateTo',
      'limit',
      'page',
      'status',
      'type',
    ]);
    expect(parameters.limit.schema).toMatchObject({ default: 10, maximum: 50 });
    expect(parameters.type.schema.enum).toEqual(Object.values(BookingType));
    expect(parameters.status.schema.enum).toEqual(states);
    expect(parameters.dateFrom.schema.format).toBe('date');
    expect(parameters.dateTo.schema.format).toBe('date');
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '500']),
    );
    expect(
      operation.responses['200'].content['application/json'].schema.properties
        .items.items,
    ).toEqual({
      $ref: '#/components/schemas/AdminBookingResponseDto',
    });
    const schema = response.body.components.schemas.AdminBookingResponseDto;
    expect(Object.keys(schema.properties).sort()).toEqual(fields);
    expect(schema.properties.bookingReference.nullable).toBe(true);
    expect(schema.properties.createdAt.format).toBe('date-time');
    expect(
      response.body.components.schemas.BookingPartyDto.properties.name.nullable,
    ).toBe(true);
  });
});
