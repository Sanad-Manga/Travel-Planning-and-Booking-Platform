import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { BookingStatus, BookingType, PaymentStatus, RefundStatus, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { HotelsModule } from '../src/hotels/hotels.module';
import { FakeStripeGateway } from '../src/payments/fake-stripe-gateway';
import { STRIPE_GATEWAY } from '../src/payments/stripe-gateway';
import { setupApp, setupSwagger } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';
const DAY_MS = 86_400_000;
const day = (offset: number): string => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const TOTAL_CENTS = 30_000;

describe('cancel a whole hotel reservation with a tier-based refund (HTL-21) over HTTP', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;
  let stripe: FakeStripeGateway;
  let travelerId: string;
  let travelerCookie: string;
  let otherCookie: string;
  let adminCookie: string;

  // Tiers: 14+ days before check-in refund 100 %, 7+ days 50 %, closer than 7 days nothing.
  const hotelId = new Types.ObjectId();
  const roomId = new Types.ObjectId();
  const http = () => request(app.getHttpServer());
  const refundRows = () => db.collection('refunds').find({}).toArray();
  const statusOf = async (id: Types.ObjectId | string) =>
    (await db.collection('hotelBookings').findOne({ _id: new Types.ObjectId(id) }))?.status;

  /** A confirmed, paid reservation of the traveler that checks in `inDays` days from today. */
  async function paidReservation(
    inDays: number,
    overrides: Record<string, unknown> = {},
    paid = true,
  ): Promise<Types.ObjectId> {
    const id = new Types.ObjectId();
    await db.collection('hotelBookings').insertOne({
      _id: id,
      userId: new Types.ObjectId(travelerId),
      hotelId,
      checkIn: day(inDays),
      checkOut: day(inDays + 2),
      nights: 2,
      rooms: [
        {
          roomId,
          adults: 2,
          children: 0,
          name: 'Standard',
          type: 'Double',
          maxOccupancy: 3,
          pricePerNightCents: TOTAL_CENTS / 2,
          totalCents: TOTAL_CENTS,
        },
      ],
      totalCents: TOTAL_CENTS,
      currency: 'USD',
      status: BookingStatus.CONFIRMED,
      bookingReference: `HTL-${id.toHexString().slice(-12).toUpperCase()}`,
      paymentRef: `pi_${id.toHexString()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    if (paid) {
      await db.collection('payments').insertOne({
        bookingType: BookingType.HOTEL,
        bookingId: id,
        userId: new Types.ObjectId(travelerId),
        stripePaymentIntentId: `pi_${id.toHexString()}`,
        amountCents: TOTAL_CENTS,
        currency: 'USD',
        status: PaymentStatus.SUCCEEDED,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return id;
  }

  async function login(email: string, role: Role): Promise<{ cookie: string; id: string }> {
    await db.collection('users').insertOne({
      name: email,
      email,
      passwordHash: hashSync(PASSWORD, 4),
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const response = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return {
      id: response.body.id,
      cookie: (response.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; '),
    };
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    stripe = new FakeStripeGateway();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        HotelsModule,
      ],
    })
      .overrideProvider(STRIPE_GATEWAY)
      .useValue(stripe)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    await db.model('User').init();
    await db.model('HotelBooking').init();
    await db.model('Payment').init();
    await db.model('Refund').init();

    await db.collection('hotels').insertOne({
      _id: hotelId,
      name: 'Cancel Hotel',
      nameKey: 'cancel hotel',
      address: '1 Test Street',
      cityId: 'CAI',
      countryCode: 'EG',
      description: 'Hotel.',
      photos: [],
      starRating: 4,
      amenities: [],
      cancellationTiers: [
        { daysBeforeThreshold: 14, refundPercent: 100 },
        { daysBeforeThreshold: 7, refundPercent: 50 },
      ],
      checkInTime: '15:00',
      checkOutTime: '11:00',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.collection('rooms').insertOne({
      _id: roomId,
      hotelId,
      name: 'Standard',
      nameKey: 'standard',
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNightCents: TOTAL_CENTS / 2,
      isActive: true,
      availability: [{ _id: new Types.ObjectId(), startDate: day(1), endDate: day(40) }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const traveler = await login('cancel-traveler@example.com', Role.USER);
    travelerId = traveler.id;
    travelerCookie = traveler.cookie;
    otherCookie = (await login('cancel-other@example.com', Role.USER)).cookie;
    adminCookie = (await login('cancel-admin@example.com', Role.ADMIN)).cookie;
  }, 180_000);

  beforeEach(async () => {
    await db.collection('hotelBookings').deleteMany({});
    await db.collection('payments').deleteMany({});
    await db.collection('refunds').deleteMany({});
    await db.collection('notifications').deleteMany({});
    stripe.refunds.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('access', () => {
    it('refuses a guest (401) and an admin (403) on both routes', async () => {
      const id = await paidReservation(20);
      await http().get(`/api/hotel-bookings/${id}/cancel-preview`).expect(401);
      await http().post(`/api/hotel-bookings/${id}/cancel`).expect(401);
      await http().get(`/api/hotel-bookings/${id}/cancel-preview`).set('Cookie', adminCookie).expect(403);
      await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', adminCookie).expect(403);
      expect(await statusOf(id)).toBe(BookingStatus.CONFIRMED);
    });

    it("answers 404 for someone else's reservation, an unknown id and a malformed id, and leaves the reservation alone", async () => {
      const id = await paidReservation(20);
      for (const target of [id.toHexString(), new Types.ObjectId().toHexString(), 'not-an-id']) {
        await http().get(`/api/hotel-bookings/${target}/cancel-preview`).set('Cookie', otherCookie).expect(404);
        await http().post(`/api/hotel-bookings/${target}/cancel`).set('Cookie', otherCookie).expect(404);
      }
      await http().post('/api/hotel-bookings/not-an-id/cancel').set('Cookie', travelerCookie).expect(404);
      expect(await statusOf(id)).toBe(BookingStatus.CONFIRMED);
      expect(await refundRows()).toHaveLength(0);
    });
  });

  describe('refund preview', () => {
    it.each([
      ['100 % tier (14+ days)', 20, TOTAL_CENTS],
      ['50 % tier (7+ days)', 10, TOTAL_CENTS / 2],
      ['no tier left (under 7 days)', 3, 0],
    ])('shows the refund before cancelling: %s', async (_label, inDays, refundCents) => {
      const id = await paidReservation(inDays);
      const response = await http().get(`/api/hotel-bookings/${id}/cancel-preview`).set('Cookie', travelerCookie).expect(200);
      expect(response.body).toMatchObject({
        bookingId: id.toHexString(),
        checkIn: day(inDays),
        totalCents: TOTAL_CENTS,
        currency: 'USD',
        refundCents,
        nonRefundableCents: TOTAL_CENTS - refundCents,
      });
      expect(response.body.checkInAt).toBe(`${day(inDays)}T15:00:00.000Z`);
      expect(response.body.daysBeforeCheckIn).toBeGreaterThan(inDays - 1);
      expect(response.body.daysBeforeCheckIn).toBeLessThan(inDays + 1);
    });

    it('changes nothing: the reservation stays CONFIRMED and no refund exists', async () => {
      const id = await paidReservation(20);
      await http().get(`/api/hotel-bookings/${id}/cancel-preview`).set('Cookie', travelerCookie).expect(200);
      expect(await statusOf(id)).toBe(BookingStatus.CONFIRMED);
      expect(await refundRows()).toHaveLength(0);
      expect(stripe.refunds.size).toBe(0);
    });

    it('refuses a reservation that cannot be cancelled with 409', async () => {
      const pending = await paidReservation(20, { status: BookingStatus.PENDING_PAYMENT, holdExpiresAt: new Date(Date.now() + 60_000) }, false);
      const started = await paidReservation(-1);
      for (const id of [pending, started]) {
        await http().get(`/api/hotel-bookings/${id}/cancel-preview`).set('Cookie', travelerCookie).expect(409);
      }
    });
  });

  describe('cancel', () => {
    it('cancels the whole reservation and refunds the full total in the 100 % tier (PAY-03 refund created)', async () => {
      const id = await paidReservation(20);
      const response = await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie).expect(200);

      expect(response.body.booking).toMatchObject({ id: id.toHexString(), status: BookingStatus.CANCELLED, totalCents: TOTAL_CENTS });
      expect(response.body.refund).toMatchObject({ status: RefundStatus.REFUNDED, amountCents: TOTAL_CENTS, currency: 'USD', bookingId: id.toHexString() });
      expect(await statusOf(id)).toBe(BookingStatus.CANCELLED);
      const stored = await db.collection('hotelBookings').findOne({ _id: id });
      expect(stored?.cancellationRefundCents).toBe(TOTAL_CENTS); // kept so that a failed refund can be completed later
      expect(stored?.cancellationRequestedAt).toBeInstanceOf(Date);

      const rows = await refundRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ bookingType: BookingType.HOTEL, bookingId: id, amountCents: TOTAL_CENTS });
      expect([...stripe.refunds.values()].map((r) => r.amountCents)).toEqual([TOTAL_CENTS]);

      // GEN-01: a distinct cancellation notice, separate from the refund notification.
      expect(
        await db.collection('notifications').countDocuments({
          userId: new Types.ObjectId(travelerId),
          type: 'BOOKING_CANCELLED',
          link: `/hotel-bookings/${id.toHexString()}`,
        }),
      ).toBe(1);
      expect(
        await db.collection('notifications').countDocuments({
          userId: new Types.ObjectId(travelerId),
          type: 'REFUND_UPDATE',
        }),
      ).toBeGreaterThan(0);

      // Not just a DB write: the traveler can actually see the cancellation through the real
      // GET /api/notifications endpoint, same as any other notification.
      const notificationsPage = await http().get('/api/notifications').set('Cookie', travelerCookie).expect(200);
      expect(notificationsPage.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'BOOKING_CANCELLED',
            title: 'Hotel reservation cancelled',
            link: `/hotel-bookings/${id.toHexString()}`,
          }),
        ]),
      );
    });

    it('refunds the percentage of the tier on the full total (50 %)', async () => {
      const id = await paidReservation(10);
      const response = await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie).expect(200);
      expect(response.body.refund.amountCents).toBe(TOTAL_CENTS / 2);
      expect([...stripe.refunds.values()].map((r) => r.amountCents)).toEqual([TOTAL_CENTS / 2]);
    });

    it('cancels without a refund when no tier applies: refund is null and nothing is sent to Stripe', async () => {
      const id = await paidReservation(3);
      const response = await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie).expect(200);
      expect(response.body.booking.status).toBe(BookingStatus.CANCELLED);
      expect(response.body.refund).toBeNull();
      expect(await refundRows()).toHaveLength(0);
      expect(stripe.refunds.size).toBe(0);

      // GEN-01: even with nothing to refund (so RefundsService never fires), the traveler still
      // gets a cancellation notice.
      expect(
        await db.collection('notifications').countDocuments({
          userId: new Types.ObjectId(travelerId),
          type: 'BOOKING_CANCELLED',
          link: `/hotel-bookings/${id.toHexString()}`,
        }),
      ).toBe(1);
    });

    it('is the same refund that the preview showed', async () => {
      const id = await paidReservation(10);
      const preview = await http().get(`/api/hotel-bookings/${id}/cancel-preview`).set('Cookie', travelerCookie).expect(200);
      const cancelled = await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie).expect(200);
      expect(cancelled.body.refund.amountCents).toBe(preview.body.refundCents);
    });

    it('releases every room of the reservation for those dates', async () => {
      const id = await paidReservation(5);
      const stay = { checkIn: day(5), checkOut: day(7), rooms: [{ roomId: roomId.toHexString(), adults: 1, children: 0 }] };
      await http().post('/api/hotel-bookings').set('Cookie', otherCookie).send(stay).expect(409); // the room is booked

      await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie).expect(200);

      await http().post('/api/hotel-bookings').set('Cookie', otherCookie).send(stay).expect(201); // the room is free again
    });

    it('cannot be cancelled twice: the second call is 409 and only one refund exists', async () => {
      const id = await paidReservation(20);
      await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie).expect(200);
      await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie).expect(409);
      expect(await refundRows()).toHaveLength(1);
      expect(stripe.refunds.size).toBe(1);
    });

    it('lets exactly one of two simultaneous cancellations win and refunds once', async () => {
      const id = await paidReservation(20);
      const results = await Promise.all([
        http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie),
        http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await refundRows()).toHaveLength(1);
      expect(stripe.refunds.size).toBe(1);
    });

    it.each([
      ['PENDING_PAYMENT', { status: BookingStatus.PENDING_PAYMENT, holdExpiresAt: new Date(Date.now() + 60_000) }, 20],
      ['COMPLETED', { status: BookingStatus.COMPLETED }, -5],
      ['EXPIRED', { status: BookingStatus.EXPIRED }, 20],
    ])('refuses a %s reservation with 409', async (_label, overrides, inDays) => {
      const id = await paidReservation(inDays, overrides, false);
      const response = await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie).expect(409);
      expect(response.body.message).toEqual(expect.stringContaining('CONFIRMED'));
      expect(await statusOf(id)).toBe(overrides.status);
    });

    it('refuses a confirmed reservation whose check-in has passed with 409 and keeps it CONFIRMED', async () => {
      const id = await paidReservation(-1);
      const response = await http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', travelerCookie).expect(409);
      expect(response.body.message).toEqual(expect.stringContaining('check-in'));
      expect(await statusOf(id)).toBe(BookingStatus.CONFIRMED);
      expect(await refundRows()).toHaveLength(0);
    });
  });

  describe('a refund that failed is completed by cancelling again', () => {
    const cancel = (cookie = travelerCookie, id: Types.ObjectId) => http().post(`/api/hotel-bookings/${id}/cancel`).set('Cookie', cookie);
    /** A reservation that was cancelled (status CANCELLED) with the refund amount its cancellation worked out, but no refund yet. */
    const cancelledWithoutRefund = (inDays: number, storedCents: number | null, cancelledDaysAgo = 1) =>
      paidReservation(inDays, {
        status: BookingStatus.CANCELLED,
        ...(storedCents === null
          ? {}
          : { cancellationRefundCents: storedCents, cancellationRequestedAt: new Date(Date.now() - cancelledDaysAgo * DAY_MS) }),
      });

    it('answers 503 when the refund cannot be issued, keeps the reservation CANCELLED and says to send the request again', async () => {
      const id = await paidReservation(20);
      jest.spyOn(stripe, 'createRefund').mockRejectedValueOnce(new Error('Stripe is down'));

      const response = await cancel(travelerCookie, id).expect(503);

      expect(response.body.message).toEqual(expect.stringContaining('cancelled'));
      expect(response.body.message).toEqual(expect.stringContaining('again'));
      expect(await statusOf(id)).toBe(BookingStatus.CANCELLED);
      expect(await refundRows()).toHaveLength(0);
    });

    it('completes the refund when the traveler cancels again, then refuses a third cancel', async () => {
      const id = await paidReservation(10); // the 50 % tier
      jest.spyOn(stripe, 'createRefund').mockRejectedValueOnce(new Error('Stripe is down'));
      await cancel(travelerCookie, id).expect(503);

      const retry = await cancel(travelerCookie, id).expect(200);

      expect(retry.body.booking).toMatchObject({ id: id.toHexString(), status: BookingStatus.CANCELLED });
      expect(retry.body.refund).toMatchObject({ status: RefundStatus.REFUNDED, amountCents: TOTAL_CENTS / 2 });
      expect(await refundRows()).toHaveLength(1);
      expect(stripe.refunds.size).toBe(1);
      await cancel(travelerCookie, id).expect(409);
      expect(await refundRows()).toHaveLength(1);
    });

    it('refunds the amount worked out when the reservation was cancelled, not the tier of the moment of the retry', async () => {
      // Cancelled long before check-in (100 %), retried when only 3 days remain (a 0 % tier now).
      const id = await cancelledWithoutRefund(3, TOTAL_CENTS, 20);
      const retry = await cancel(travelerCookie, id).expect(200);
      expect(retry.body.refund.amountCents).toBe(TOTAL_CENTS);
    });

    it('still completes after the check-in time has passed', async () => {
      const id = await cancelledWithoutRefund(-1, TOTAL_CENTS / 2, 20);
      const retry = await cancel(travelerCookie, id).expect(200);
      expect(retry.body.refund.amountCents).toBe(TOTAL_CENTS / 2);
    });

    it.each([
      ['no amount was recorded (it was not cancelled by this route)', null],
      ['the cancellation had nothing to refund', 0],
    ])('refuses with 409 when %s, and creates no refund', async (_label, stored) => {
      const id = await cancelledWithoutRefund(20, stored);
      const response = await cancel(travelerCookie, id).expect(409);
      expect(response.body.message).toEqual(expect.stringContaining('CONFIRMED'));
      expect(await refundRows()).toHaveLength(0);
    });

    it('lets exactly one of two simultaneous retries issue the refund', async () => {
      const id = await cancelledWithoutRefund(20, TOTAL_CENTS);
      const results = await Promise.all([cancel(travelerCookie, id), cancel(travelerCookie, id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await refundRows()).toHaveLength(1);
      expect(stripe.refunds.size).toBe(1);
    });

    it("answers 404 when someone else tries to complete the refund of a cancelled reservation", async () => {
      const id = await cancelledWithoutRefund(20, TOTAL_CENTS);
      await cancel(otherCookie, id).expect(404);
      expect(await refundRows()).toHaveLength(0);
    });
  });

  it('documents both routes in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const preview = response.body.paths['/api/hotel-bookings/{id}/cancel-preview'].get;
    const cancel = response.body.paths['/api/hotel-bookings/{id}/cancel'].post;
    expect(preview.summary).toContain('HTL-21');
    expect(cancel.summary).toContain('HTL-21');
    expect(Object.keys(preview.responses)).toEqual(expect.arrayContaining(['200', '401', '403', '404', '409']));
    expect(Object.keys(cancel.responses)).toEqual(expect.arrayContaining(['200', '401', '403', '404', '409', '503']));
  });
});
