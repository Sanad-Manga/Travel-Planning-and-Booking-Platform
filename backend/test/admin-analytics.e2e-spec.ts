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
import {
  AccountStatus,
  BookingStatus,
  BookingType,
  PaymentStatus,
  RefundStatus,
  Role,
} from '../src/common';
import { setupApp, setupSwagger } from '../src/setup-app';
import { UPLOAD_OPTIONS } from '../src/uploads/upload-options';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.setTimeout(120000);

const route = '/api/admin/analytics';
const period = { dateFrom: '2026-11-20', dateTo: '2026-11-20' };
const defaultTime = '2026-11-20T12:00:00.000Z';
const { FLIGHT, HOTEL } = BookingType;
const { CONFIRMED, COMPLETED, CANCELLED, EXPIRED, PENDING_PAYMENT } =
  BookingStatus;
const { REFUNDED, PENDING, FAILED } = RefundStatus;
const oid = () => new Types.ObjectId();
const airlineA = new Types.ObjectId('650000000000000000000001');
const airlineB = new Types.ObjectId('650000000000000000000002');
const hotelA = new Types.ObjectId('650000000000000000000003');
const missingHotel = new Types.ObjectId('650000000000000000000004');
const userId = oid();
const access = 'bon01-fixture-access-0123456789abcdef';
const settings = {
  MONGODB_URI: '',
  JWT_ACCESS_SECRET: access,
  JWT_REFRESH_SECRET: 'bon01-fixture-refresh-0123456789abcdef',
  COOKIE_SECURE: 'false',
};
const previous = Object.keys(settings).map(
  (key) => [key, process.env[key]] as const,
);

function sign(id: Types.ObjectId, role: Role, expiresIn = 900) {
  return (
    'access_token=' +
    new JwtService().sign(
      { sub: String(id), role },
      { secret: access, expiresIn },
    )
  );
}

function booking(
  type: BookingType,
  providerId: Types.ObjectId,
  status: BookingStatus,
  totalCents: number,
  options: { _id?: Types.ObjectId; currency?: string; at?: string } = {},
) {
  return {
    _id: options._id ?? oid(),
    userId,
    ...(type === FLIGHT ? { airlineId: providerId } : { hotelId: providerId }),
    totalCents,
    status,
    currency: options.currency ?? 'EGP',
    createdAt: new Date(options.at ?? defaultTime),
    paymentRef: 'fixture-private-reference',
  };
}

function refund(
  bookingType: BookingType,
  bookingId: Types.ObjectId,
  amountCents: number,
  status: RefundStatus,
  currency = 'EGP',
) {
  return {
    bookingType,
    bookingId,
    userId,
    amountCents,
    status,
    currency,
    stripePaymentIntentId: 'pi_fixture_' + oid(),
    stripeRefundId: 're_fixture_' + oid(),
    // Deliberately outside the booking period. A present-day refund adjusts its original booking.
    createdAt: new Date('2026-12-12T12:00:00.000Z'),
  };
}

describe('BON-01 admin analytics in the real AppModule', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let root: string;
  let db: Connection;
  let adminId: Types.ObjectId;
  const cookies = new Map<Role, string>();
  const http = () => request(app.getHttpServer());
  const analytics = (query: Record<string, unknown> = period) =>
    http().get(route).set('Cookie', cookies.get(Role.ADMIN)!).query(query);

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'bon01-e2e-'));
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
        email: role.toLowerCase() + '@example.test',
        status: AccountStatus.ACTIVE,
        role,
        passwordHash: 'fixture-private-hash',
      });
      cookies.set(role, sign(id, role));
    }
    await db.collection('airlines').insertMany([
      { _id: airlineB, name: 'Airline B', code: 'BB' },
      { _id: airlineA, name: 'Airline A', code: 'AA' },
    ]);
    await db
      .collection('hotels')
      .insertOne({ _id: hotelA, name: 'Hotel A', nameKey: 'hotel a' });

    const partial = booking(FLIGHT, airlineA, CONFIRMED, 1200, {
      at: '2026-11-20T00:00:00.000Z',
    });
    const cancelled = booking(FLIGHT, airlineA, CANCELLED, 500);
    const otherCurrency = booking(FLIGHT, airlineA, CONFIRMED, 275, {
      currency: 'USD',
    });
    const pendingRefund = booking(FLIGHT, airlineB, CONFIRMED, 300);
    await db.collection('flightBookings').insertMany([
      pendingRefund,
      { ...partial, segments: [{ flightId: oid() }, { flightId: oid() }] },
      otherCurrency,
      cancelled,
      booking(FLIGHT, airlineA, PENDING_PAYMENT, 800),
      booking(FLIGHT, airlineA, EXPIRED, 600),
      booking(FLIGHT, airlineA, COMPLETED, 700),
      booking(FLIGHT, airlineA, CONFIRMED, 9000, {
        at: '2026-11-19T23:59:59.999Z',
      }),
      booking(FLIGHT, airlineA, CONFIRMED, 9100, {
        at: '2026-11-21T00:00:00.000Z',
      }),
    ]);
    await db.collection('hotelBookings').insertMany([
      booking(HOTEL, missingHotel, CANCELLED, 350),
      {
        ...booking(HOTEL, hotelA, CONFIRMED, 600, {
          at: '2026-11-20T23:59:59.999Z',
        }),
        rooms: [{ roomId: oid() }, { roomId: oid() }],
      },
      booking(HOTEL, hotelA, PENDING_PAYMENT, 400),
    ]);
    await db
      .collection('refunds')
      .insertMany([
        refund(FLIGHT, partial._id, 200, REFUNDED),
        refund(FLIGHT, cancelled._id, 40, REFUNDED),
        refund(FLIGHT, otherCurrency._id, 25, FAILED, 'USD'),
        refund(FLIGHT, pendingRefund._id, 100, PENDING),
      ]);
    await db.collection('payments').insertOne({
      bookingType: FLIGHT,
      bookingId: partial._id,
      userId,
      stripePaymentIntentId: 'pi_fixture_initial',
      amountCents: 1200,
      currency: 'EGP',
      status: PaymentStatus.SUCCEEDED,
    });
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
    await http().get(route).query(period).expect(401);
    await http()
      .get(route)
      .query(period)
      .set('Cookie', 'access_token=invalid')
      .expect(401);
    await http()
      .get(route)
      .query(period)
      .set('Cookie', sign(adminId, Role.ADMIN, -1))
      .expect(401);
  });

  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'forbids authenticated %s',
    async (role) => {
      await http()
        .get(route)
        .query(period)
        .set('Cookie', cookies.get(role)!)
        .expect(403);
    },
  );

  it('returns the exact ordered cross-provider report with inclusive UTC bounds and net confirmed and completed cents', async () => {
    const result = await analytics().expect(200);
    expect(result.body).toEqual({
      period,
      summary: {
        totalBookings: 10,
        flightBookings: 7,
        hotelBookings: 3,
        confirmedBookings: 5,
      },
      providers: [
        {
          type: FLIGHT,
          providerId: String(airlineA),
          providerName: 'Airline A',
          bookingCount: 6,
          confirmedBookingCount: 3,
          revenueByCurrency: [
            { currency: 'EGP', revenueCents: 1700 },
            { currency: 'USD', revenueCents: 275 },
          ],
        },
        {
          type: FLIGHT,
          providerId: String(airlineB),
          providerName: 'Airline B',
          bookingCount: 1,
          confirmedBookingCount: 1,
          revenueByCurrency: [{ currency: 'EGP', revenueCents: 300 }],
        },
        {
          type: HOTEL,
          providerId: String(hotelA),
          providerName: 'Hotel A',
          bookingCount: 2,
          confirmedBookingCount: 1,
          revenueByCurrency: [{ currency: 'EGP', revenueCents: 600 }],
        },
        {
          type: HOTEL,
          providerId: String(missingHotel),
          providerName: null,
          bookingCount: 1,
          confirmedBookingCount: 0,
          revenueByCurrency: [],
        },
      ],
    });
    expect((await analytics().expect(200)).body).toEqual(result.body);
  });

  it.each([
    ['dateFrom', { dateTo: period.dateTo }],
    ['dateTo', { dateFrom: period.dateFrom }],
    ['dateFrom', { ...period, dateFrom: '2026-02-30' }],
    ['dateTo', { ...period, dateTo: '2026-11-20T00:00:00Z' }],
    ['dateTo', { ...period, dateTo: '2026-11-19' }],
    ['page', { ...period, page: 1 }],
  ])('returns a field-level 400 for invalid %s (%j)', async (field, query) => {
    const result = await analytics(query).expect(400);
    expect(result.body).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
      path: route,
      details: expect.arrayContaining([
        expect.objectContaining({ field, message: expect.any(String) }),
      ]),
    });
  });

  it('returns a zero report for a period without bookings', async () => {
    const empty = { dateFrom: '2025-01-01', dateTo: '2025-12-31' };
    const result = await analytics(empty).expect(200);
    expect(result.body).toEqual({
      period: empty,
      summary: {
        totalBookings: 0,
        flightBookings: 0,
        hotelBookings: 0,
        confirmedBookings: 0,
      },
      providers: [],
    });
  });

  it('only reads booking, payment and refund records and returns no private identifiers', async () => {
    const collections = [
      'flightBookings',
      'hotelBookings',
      'payments',
      'refunds',
    ];
    const snapshot = () =>
      Promise.all(
        collections.map((name) =>
          db.collection(name).find({}).sort({ _id: 1 }).toArray(),
        ),
      );
    const before = await snapshot();
    const result = await analytics().expect(200);
    expect(JSON.stringify(result.body)).not.toMatch(
      /userId|paymentRef|stripe|fixture-private/,
    );
    await http()
      .post(route)
      .set('Cookie', cookies.get(Role.ADMIN)!)
      .expect(404);
    expect(await snapshot()).toEqual(before);
  });

  it('documents a single admin GET, required period, response and errors', async () => {
    const document = (await http().get('/api/docs-json').expect(200)).body;
    const path = document.paths[route];
    expect(Object.keys(path)).toEqual(['get']);
    expect(path.get.security).toContainEqual({ cookie: [] });
    expect(path.get.parameters).toEqual(
      expect.arrayContaining(
        ['dateFrom', 'dateTo'].map((name) =>
          expect.objectContaining({
            name,
            required: true,
            schema: expect.objectContaining({ type: 'string', format: 'date' }),
          }),
        ),
      ),
    );
    expect(path.get.parameters).toHaveLength(2);
    expect(Object.keys(path.get.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '500',
    ]);
    expect(
      path.get.responses['200'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/AdminAnalyticsResponseDto');
    expect(
      Object.keys(
        document.components.schemas.AdminAnalyticsResponseDto.properties,
      ).sort(),
    ).toEqual(['period', 'providers', 'summary']);
    expect(
      document.components.schemas.AnalyticsRevenueDto.properties.revenueCents
        .type,
    ).toBe('integer');
  });

  describe('independent adversarial cases', () => {
    const onDay = (day: number) => {
      const date = '2026-12-' + String(day).padStart(2, '0');
      return { dateFrom: date, dateTo: date };
    };
    const atDay = (day: number) => onDay(day).dateFrom + 'T23:59:59.999Z';
    const expectSafeFailure = async (day: number) => {
      const response = await analytics(onDay(day)).expect(500);
      expect(response.body).toMatchObject({
        statusCode: 500,
        message: 'Analytics could not be retrieved',
        path: route,
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /fixture-private|MongoServerError|stripePaymentIntentId|\$lookup/,
      );
    };

    it('separates identical booking and provider IDs across types and keeps tied revenue rows', async () => {
      const sharedId = oid();
      const at = atDay(1);
      const partial = booking(FLIGHT, airlineA, CONFIRMED, 1200, {
        _id: sharedId,
        at,
      });
      const sameHotelId = booking(HOTEL, airlineA, CONFIRMED, 900, {
        _id: sharedId,
        at,
      });
      await db.collection('flightBookings').insertOne(partial);
      await db.collection('hotelBookings').insertOne(sameHotelId);
      const refunds = [
        refund(FLIGHT, sharedId, 100, REFUNDED),
        refund(FLIGHT, sharedId, 200, REFUNDED),
      ];
      await db.collection('refunds').insertMany(refunds);
      await db.collection('payments').insertMany(
        [
          {
            stripePaymentIntentId: 'pi_fixture_failed_' + oid(),
            status: PaymentStatus.FAILED,
          },
          ...refunds.map((row) => ({
            stripePaymentIntentId: row.stripePaymentIntentId,
            status: PaymentStatus.SUCCEEDED,
          })),
        ].map((payment) => ({
          ...payment,
          bookingType: FLIGHT,
          bookingId: sharedId,
          userId,
          amountCents: 1200,
          currency: 'EGP',
        })),
      );

      const result = await analytics(onDay(1)).expect(200);
      expect(result.body.summary).toEqual({
        totalBookings: 2,
        flightBookings: 1,
        hotelBookings: 1,
        confirmedBookings: 2,
      });
      expect(result.body.providers).toEqual([
        {
          type: FLIGHT,
          providerId: String(airlineA),
          providerName: 'Airline A',
          bookingCount: 1,
          confirmedBookingCount: 1,
          revenueByCurrency: [{ currency: 'EGP', revenueCents: 900 }],
        },
        {
          type: HOTEL,
          providerId: String(airlineA),
          providerName: null,
          bookingCount: 1,
          confirmedBookingCount: 1,
          revenueByCurrency: [{ currency: 'EGP', revenueCents: 900 }],
        },
      ]);
    });

    it('keeps fully refunded confirmed bookings in counts but excludes both cancelled refund states from revenue', async () => {
      const at = atDay(2);
      const paid = booking(HOTEL, hotelA, CONFIRMED, 301, { at });
      const settledCancellation = booking(HOTEL, hotelA, CANCELLED, 80, { at });
      const failedCancellation = booking(HOTEL, hotelA, CANCELLED, 70, { at });
      await db
        .collection('hotelBookings')
        .insertMany([paid, settledCancellation, failedCancellation]);
      await db
        .collection('refunds')
        .insertMany([
          refund(HOTEL, paid._id, 301, REFUNDED),
          refund(HOTEL, settledCancellation._id, 80, REFUNDED),
          refund(HOTEL, failedCancellation._id, 70, FAILED),
        ]);
      const result = await analytics(onDay(2)).expect(200);
      expect(result.body.providers).toEqual([
        {
          type: HOTEL,
          providerId: String(hotelA),
          providerName: 'Hotel A',
          bookingCount: 3,
          confirmedBookingCount: 1,
          revenueByCurrency: [{ currency: 'EGP', revenueCents: 0 }],
        },
      ]);
    });

    it('keeps a booking in revenue when the nightly sweep moves it from CONFIRMED to COMPLETED', async () => {
      const at = atDay(6);
      const stay = booking(HOTEL, hotelA, CONFIRMED, 450, { at });
      await db.collection('hotelBookings').insertOne(stay);
      const before = await analytics(onDay(6)).expect(200);
      expect(before.body.providers).toEqual([
        {
          type: HOTEL,
          providerId: String(hotelA),
          providerName: 'Hotel A',
          bookingCount: 1,
          confirmedBookingCount: 1,
          revenueByCurrency: [{ currency: 'EGP', revenueCents: 450 }],
        },
      ]);

      await db
        .collection('hotelBookings')
        .updateOne({ _id: stay._id }, { $set: { status: COMPLETED } });
      const after = await analytics(onDay(6)).expect(200);
      expect(after.body).toEqual(before.body);
      expect(after.body.summary.confirmedBookings).toBe(1);
    });

    it('normalizes legacy currency casing, nets exact large cents and keeps currency units separate', async () => {
      const at = atDay(3);
      const huge = booking(
        FLIGHT,
        airlineA,
        CONFIRMED,
        Number.MAX_SAFE_INTEGER,
        { at, currency: 'usd' },
      );
      await db
        .collection('flightBookings')
        .insertMany([
          huge,
          booking(FLIGHT, airlineA, CONFIRMED, 1, { at, currency: 'USD' }),
          booking(FLIGHT, airlineA, CONFIRMED, 72, { at }),
          booking(FLIGHT, airlineB, EXPIRED, 900, { at }),
        ]);
      await db
        .collection('refunds')
        .insertOne(refund(FLIGHT, huge._id, 3, REFUNDED, 'USD'));
      const requestPeriod = {
        dateFrom: onDay(3).dateFrom,
        dateTo: onDay(4).dateTo,
      };
      const result = await analytics(requestPeriod).expect(200);
      expect(result.body.providers).toEqual([
        {
          type: FLIGHT,
          providerId: String(airlineA),
          providerName: 'Airline A',
          bookingCount: 3,
          confirmedBookingCount: 3,
          revenueByCurrency: [
            { currency: 'EGP', revenueCents: 72 },
            { currency: 'USD', revenueCents: Number.MAX_SAFE_INTEGER - 2 },
          ],
        },
        {
          type: FLIGHT,
          providerId: String(airlineB),
          providerName: 'Airline B',
          bookingCount: 1,
          confirmedBookingCount: 0,
          revenueByCurrency: [],
        },
      ]);
      const empty = await analytics(onDay(4)).expect(200);
      expect(empty.body.summary.totalBookings).toBe(0);
      expect(empty.body.providers).toEqual([]);
    });

    it.each([
      { day: 5, amountCents: 100.25, refundCents: 0, refundCurrency: 'EGP' },
      { day: 6, amountCents: 100, refundCents: 25, refundCurrency: 'USD' },
      { day: 7, amountCents: 100, refundCents: 101, refundCurrency: 'EGP' },
    ])(
      'fails safely on inconsistent stored financial data (day $day)',
      async ({ day, amountCents, refundCents, refundCurrency }) => {
        const row = booking(FLIGHT, airlineA, CONFIRMED, amountCents, {
          at: atDay(day),
        });
        await db.collection('flightBookings').insertOne(row);
        if (refundCents)
          await db
            .collection('refunds')
            .insertOne(
              refund(FLIGHT, row._id, refundCents, REFUNDED, refundCurrency),
            );
        await expectSafeFailure(day);
      },
    );

    it('fails safely when a provider total exceeds the JSON safe-integer range', async () => {
      const at = atDay(8);
      await db
        .collection('flightBookings')
        .insertMany([
          booking(FLIGHT, airlineA, CONFIRMED, Number.MAX_SAFE_INTEGER, { at }),
          booking(FLIGHT, airlineA, CONFIRMED, 1, { at }),
        ]);
      await expectSafeFailure(8);
    });

    it('rejects a malformed booking with no provider identity instead of emitting an invalid provider row', async () => {
      const row = booking(FLIGHT, airlineA, CONFIRMED, 40, { at: atDay(9) });
      await db
        .collection('flightBookings')
        .insertOne({ ...row, airlineId: null });
      await expectSafeFailure(9);
    });

    it('rejects repeated date bounds and Mongo-style parameters with a field-level 400', async () => {
      for (const [query, field] of [
        [
          'dateFrom=2026-11-20&dateFrom=2026-11-19&dateTo=2026-11-20',
          'dateFrom',
        ],
        ['dateFrom=2026-11-20&dateTo=2026-11-20&%24where=test', '$where'],
      ]) {
        const result = await http()
          .get(route + '?' + query)
          .set('Cookie', cookies.get(Role.ADMIN)!)
          .expect(400);
        expect(result.body.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      }
    });

    it('returns a sanitized 500 when the aggregate rejects', async () => {
      jest
        .spyOn(db.model('FlightBooking'), 'aggregate')
        .mockImplementationOnce(() => {
          throw new Error('fixture-private-driver-diagnostic');
        });
      await expectSafeFailure(1);
    });
  });
});
