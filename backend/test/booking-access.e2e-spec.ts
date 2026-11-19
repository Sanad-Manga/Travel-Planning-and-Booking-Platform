import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AirlinesModule } from '../src/airlines';
import { AuthModule } from '../src/auth/auth.module';
import { BookingStatus, BookingType, PaymentStatus, RefundStatus, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { FlightsModule } from '../src/flights';
import { HotelsModule } from '../src/hotels/hotels.module';
import { NotificationsModule } from '../src/notifications';
import { PaymentsModule, STRIPE_GATEWAY } from '../src/payments';
import { FakeStripeGateway } from '../src/payments/fake-stripe-gateway';
import { RefundsModule } from '../src/refunds';
import { ReferenceDataModule } from '../src/reference-data/reference-data.module';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

jest.setTimeout(180000);

/**
 * ACC-11 (#152): who may read a booking, a payment, a refund or the policies of a booking, per role.
 * Rule: only the owner reads them (another user gets 404, the same as for an unknown id). Admins and moderators do not
 * read single bookings through these traveler routes (403 from the role guard); they have their own routes:
 * GET /api/admin/bookings (ACC-17, test/admin-bookings.e2e-spec.ts), GET /api/flights/:id/bookings (FLT-29,
 * test/flight-roster.e2e-spec.ts) and GET /api/hotels/:id/reservations (HTL-22, test/hotel-moderator-reservations.e2e-spec.ts).
 */
describe('ACC-11 owner-only access to bookings, payments and refunds, per role (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;
  const jwt = new JwtService({ secret: TEST_ACCESS_SECRET });
  const http = () => request(app.getHttpServer());

  const owner = new Types.ObjectId();
  const hotelId = new Types.ObjectId();
  const airlineId = new Types.ObjectId();
  const hotelBookingId = new Types.ObjectId();
  const flightBookingId = new Types.ObjectId();
  const paymentId = new Types.ObjectId();
  const refundId = new Types.ObjectId();
  const cookies: Record<string, string> = {};

  const account = async (role: Role, claims: Record<string, string> = {}, _id = new Types.ObjectId()): Promise<string> => {
    await db.collection('users').insertOne({
      _id,
      name: `${role} account`,
      email: `${_id.toHexString()}@access.test`,
      passwordHash: 'x',
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return `access_token=${await jwt.signAsync({ sub: _id.toHexString(), role, ...claims }, { expiresIn: '30m' })}`;
  };

  const as = (name: string | undefined, url: string, method: 'get' | 'post' = 'get') => {
    const req = http()[method](url);
    return name ? req.set('Cookie', cookies[name]) : req;
  };

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryServer.create();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        AirlinesModule,
        ReferenceDataModule,
        NotificationsModule,
        PaymentsModule,
        RefundsModule,
        FlightsModule,
        HotelsModule,
      ],
    })
      .overrideProvider(STRIPE_GATEWAY)
      .useValue(new FakeStripeGateway())
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());

    cookies.owner = await account(Role.USER, {}, owner);
    cookies.other = await account(Role.USER);
    cookies.admin = await account(Role.ADMIN);
    cookies.airlineMod = await account(Role.AIRLINE_MODERATOR, { airlineId: airlineId.toHexString() });
    cookies.otherAirlineMod = await account(Role.AIRLINE_MODERATOR, { airlineId: new Types.ObjectId().toHexString() });
    cookies.hotelMod = await account(Role.HOTEL_MODERATOR, { hotelId: hotelId.toHexString() });
    cookies.otherHotelMod = await account(Role.HOTEL_MODERATOR, { hotelId: new Types.ObjectId().toHexString() });

    const now = new Date();
    await db.collection('hotels').insertOne({
      _id: hotelId,
      name: 'Nile Palace',
      nameKey: 'nile palace',
      address: '1 Corniche Street',
      cityId: 'CAI',
      countryCode: 'EG',
      description: 'Hotel.',
      photos: [],
      starRating: 5,
      amenities: [],
      cancellationTiers: [],
      checkInTime: '15:00',
      checkOutTime: '11:00',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const roomId = new Types.ObjectId();
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    await db.collection('hotelBookings').insertOne({
      _id: hotelBookingId,
      userId: owner,
      hotelId,
      checkIn: day(10),
      checkOut: day(12),
      nights: 2,
      rooms: [{ roomId, adults: 2, children: 0, name: '101', type: 'Double', maxOccupancy: 3, pricePerNightCents: 8500, totalCents: 17000 }],
      totalCents: 17000,
      currency: 'USD',
      status: BookingStatus.CONFIRMED,
      paymentRef: 'pi_secret_reference',
      bookingReference: 'HTL-ACC11001',
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('flightBookings').insertOne({
      _id: flightBookingId,
      userId: owner,
      airlineId,
      flightId: new Types.ObjectId(),
      cabinClass: 'ECONOMY',
      status: BookingStatus.PENDING_PAYMENT,
      totalCents: 10000,
      currency: 'USD',
      holdExpiresAt: new Date(Date.now() + 600_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('payments').insertOne({
      _id: paymentId,
      bookingType: BookingType.HOTEL,
      bookingId: hotelBookingId,
      userId: owner,
      stripePaymentIntentId: 'pi_acc11',
      amountCents: 17000,
      currency: 'USD',
      status: PaymentStatus.SUCCEEDED,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('refunds').insertOne({
      _id: refundId,
      bookingType: BookingType.HOTEL,
      bookingId: hotelBookingId,
      userId: owner,
      stripePaymentIntentId: 'pi_acc11',
      stripeRefundId: 're_acc11',
      amountCents: 5000,
      currency: 'USD',
      status: RefundStatus.REFUNDED,
      reason: 'internal reason',
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  const NON_OWNER_STAFF = ['admin', 'airlineMod', 'otherAirlineMod', 'hotelMod', 'otherHotelMod'];

  // [label, url]: owner-only single-resource reads. The owner opens it (200), anyone else does not.
  const OWNER_ROUTES: [string, () => string][] = [
    ['GET /api/hotel-bookings/:id', () => `/api/hotel-bookings/${hotelBookingId}`],
    ['GET /api/hotel-bookings/:id/cancel-preview', () => `/api/hotel-bookings/${hotelBookingId}/cancel-preview`],
    ['GET /api/payments/:id', () => `/api/payments/${paymentId}`],
    ['GET /api/refunds/:id', () => `/api/refunds/${refundId}`],
    ['GET /api/bookings/HOTEL/:id/policies', () => `/api/bookings/HOTEL/${hotelBookingId}/policies`],
  ];

  describe.each(OWNER_ROUTES)('%s', (_label, url) => {
    it('the owner reads it', async () => {
      await as('owner', url()).expect(200);
    });
    it('a guest gets 401', async () => {
      await as(undefined, url()).expect(401);
    });
    it('another user gets 404, identical to an unknown id', async () => {
      const theirs = await as('other', url()).expect(404);
      const unknownUrl = url().replace(/[0-9a-f]{24}/, new Types.ObjectId().toHexString());
      const unknown = await as('other', unknownUrl).expect(404);
      expect(theirs.body.message.replace(/\s.*/, '')).toBe(unknown.body.message.replace(/\s.*/, ''));
      expect(JSON.stringify(theirs.body)).not.toMatch(/pi_acc11|re_acc11|pi_secret_reference|HTL-ACC11001/);
    });
    it.each(NON_OWNER_STAFF)('%s gets 403 (admins and moderators use their own routes)', async (who) => {
      await as(who, url()).expect(403);
    });
  });

  describe('GET /api/flight-bookings/:id and /e-ticket', () => {
    const urls = () => [`/api/flight-bookings/${flightBookingId}`, `/api/flight-bookings/${flightBookingId}/e-ticket`];
    it('a guest gets 401, another user 404 (same as unknown), every staff role 403', async () => {
      for (const url of urls()) {
        await as(undefined, url).expect(401);
        await as('other', url).expect(404);
        for (const who of NON_OWNER_STAFF) await as(who, url).expect(403);
      }
      await as('other', `/api/flight-bookings/${new Types.ObjectId()}`).expect(404);
    });
    it('the owner is not refused (a pending booking has no e-ticket: 409, not 404/403)', async () => {
      await as('owner', `/api/flight-bookings/${flightBookingId}/e-ticket`).expect(409);
    });
  });

  describe('my booking lists', () => {
    it('flights: staff 403, guest 401, another user sees none of the owner bookings', async () => {
      await as(undefined, '/api/flight-bookings').expect(401);
      for (const who of NON_OWNER_STAFF) await as(who, '/api/flight-bookings').expect(403);
      const res = await as('other', '/api/flight-bookings').expect(200);
      expect(res.body).toMatchObject({ items: [], total: 0 });
    });
    it('hotels: staff 403, guest 401, another user sees none of the owner bookings, the owner sees theirs', async () => {
      await as(undefined, '/api/hotel-bookings').expect(401);
      for (const who of NON_OWNER_STAFF) await as(who, '/api/hotel-bookings').expect(403);
      expect((await as('other', '/api/hotel-bookings').expect(200)).body).toMatchObject({ items: [], total: 0 });
      expect((await as('owner', '/api/hotel-bookings').expect(200)).body.total).toBe(1);
    });
  });

  describe('moderator routes keep their own rules', () => {
    it('flight roster and export: only the moderator role; an admin, a hotel moderator and a traveler get 403', async () => {
      for (const url of [`/api/flights/${new Types.ObjectId()}/bookings`, `/api/flights/${new Types.ObjectId()}/passengers/export`]) {
        await as(undefined, url).expect(401);
        for (const who of ['owner', 'admin', 'hotelMod']) await as(who, url).expect(403);
      }
    });
    it('hotel reservations: only the moderator of that hotel; an admin, an airline moderator, a traveler and another hotel moderator get 403', async () => {
      const url = `/api/hotels/${hotelId}/reservations`;
      await as(undefined, url).expect(401);
      for (const who of ['owner', 'admin', 'airlineMod', 'otherHotelMod']) await as(who, url).expect(403);
      const res = await as('hotelMod', url).expect(200);
      expect(res.body.total).toBe(1);
    });
  });
});
