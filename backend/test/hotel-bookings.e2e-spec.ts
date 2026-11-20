import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { BookingStatus, BookingType, HOLD_MINUTES, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { HOTEL_SEARCH_MAX_ROOMS } from '../src/hotels/hotels.constants';
import { HotelBookingsService } from '../src/hotels/hotel-bookings.service';
import { HotelBooking } from '../src/hotels/schemas/hotel-booking.schema';
import { BookingLifecycle, BookingProviderRegistry } from '../src/payments';
import { setupApp, setupSwagger } from '../src/setup-app';
import { UpcomingBookingsRegistry } from '../src/users/upcoming-bookings';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';
const DAY_MS = 86_400_000;
const day = (offset: number): string => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

describe('hotel bookings (HTL-16) over HTTP', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;
  let hotelId: Types.ObjectId;
  let otherHotelId: Types.ObjectId;
  let travelerCookie: string;
  let travelerId: string;
  let otherTravelerCookie: string;
  let otherTravelerId: string;
  let adminCookie: string;
  let moderatorCookie: string;
  let otherHotelModeratorCookie: string;
  let lifecycle: BookingLifecycle;

  const roomIds = {
    standard: new Types.ObjectId(),
    family: new Types.ObjectId(),
    otherHotel: new Types.ObjectId(),
    inactive: new Types.ObjectId(),
  };
  const http = () => request(app.getHttpServer());
  const bookingCount = () => db.collection('hotelBookings').countDocuments();
  const completedStayFixture = async (
    checkOut = day(-1),
    roomsCount = 1,
    userId = travelerId,
    ownerHotelId = hotelId,
  ): Promise<Types.ObjectId> => {
    const id = new Types.ObjectId();
    await db.collection('hotelBookings').insertOne({
      _id: id,
      userId: new Types.ObjectId(userId),
      hotelId: ownerHotelId,
      checkIn: day(-3),
      checkOut,
      rooms: Array.from({ length: roomsCount }, () => ({
        roomId: roomIds.standard,
        adults: 1,
        children: 0,
        name: 'Standard',
        type: 'Double',
        maxOccupancy: 3,
        pricePerNightCents: 8_500,
        totalCents: 17_000,
      })),
      nights: 2,
      totalCents: roomsCount * 17_000,
      currency: 'USD',
      status: BookingStatus.CONFIRMED,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  };
  const requestBody = (roomId: Types.ObjectId, extra: Record<string, unknown> = {}) => ({
    checkIn: day(2),
    checkOut: day(5),
    rooms: [{ roomId: roomId.toHexString(), adults: 1, children: 0, ...extra }],
  });

  async function loginAsTraveler() {
    await db.collection('users').insertOne({
      name: 'Hotel Traveler',
      email: 'hotel-traveler@example.com',
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.USER,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const response = await http().post('/api/auth/login').send({ email: 'hotel-traveler@example.com', password: PASSWORD }).expect(200);
    travelerId = response.body.id;
    travelerCookie = (response.headers['set-cookie'] as unknown as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }

  const hotel = (id: Types.ObjectId, name: string) => ({
    _id: id,
    name,
    nameKey: name.toLowerCase(),
    address: '1 Test Street',
    cityId: 'CAI',
    countryCode: 'EG',
    description: 'Hotel.',
    photos: [],
    starRating: 4,
    amenities: [],
    cancellationTiers: [{ daysBeforeThreshold: 7, refundPercent: 50 }],
    checkInTime: '15:00',
    checkOutTime: '11:00',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const room = (id: Types.ObjectId, ownerHotelId: Types.ObjectId, name: string, pricePerNightCents: number, maxOccupancy: number, isActive = true) => ({
    _id: id,
    hotelId: ownerHotelId,
    name,
    nameKey: name.toLowerCase(),
    type: 'Double',
    beds: 2,
    maxOccupancy,
    pricePerNightCents,
    isActive,
    availability: [{ _id: new Types.ObjectId(), startDate: day(1), endDate: day(10) }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        AuthModule,
        (await import('../src/hotels/hotels.module')).HotelsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    lifecycle = app.get(BookingLifecycle);

    await db.model('User').init();
    await db.model(HotelBooking.name).init();
    await db.model('HotelReview').init();
    hotelId = new Types.ObjectId();
    otherHotelId = new Types.ObjectId();
    await db.collection('hotels').insertMany([hotel(hotelId, 'Alpha'), hotel(otherHotelId, 'Beta')]);
    await db.collection('rooms').insertMany([
      room(roomIds.standard, hotelId, 'Standard', 8_500, 3),
      room(roomIds.family, hotelId, 'Family', 12_000, 4),
      room(roomIds.otherHotel, otherHotelId, 'Other Hotel', 5_000, 2),
      room(roomIds.inactive, hotelId, 'Inactive', 1_000, 2, false),
    ]);
    await loginAsTraveler();
    await db.collection('users').insertOne({
      name: 'Other Hotel Traveler',
      email: 'other-hotel-traveler@example.com',
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.USER,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const otherLogin = await http()
      .post('/api/auth/login')
      .send({ email: 'other-hotel-traveler@example.com', password: PASSWORD })
      .expect(200);
    otherTravelerId = otherLogin.body.id;
    otherTravelerCookie = (otherLogin.headers['set-cookie'] as unknown as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    await db.collection('users').insertOne({
      name: 'Hotel Admin',
      email: 'hotel-admin@example.com',
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.ADMIN,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const adminLogin = await http()
      .post('/api/auth/login')
      .send({ email: 'hotel-admin@example.com', password: PASSWORD })
      .expect(200);
    adminCookie = (adminLogin.headers['set-cookie'] as unknown as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

    await db.collection('users').insertOne({
      name: 'Alpha Moderator',
      email: 'alpha-moderator@example.com',
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.HOTEL_MODERATOR,
      hotelId,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const moderatorLogin = await http()
      .post('/api/auth/login')
      .send({ email: 'alpha-moderator@example.com', password: PASSWORD })
      .expect(200);
    moderatorCookie = (moderatorLogin.headers['set-cookie'] as unknown as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

    await db.collection('users').insertOne({
      name: 'Beta Moderator',
      email: 'beta-moderator@example.com',
      passwordHash: hashSync(PASSWORD, 4),
      role: Role.HOTEL_MODERATOR,
      hotelId: otherHotelId,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const otherModeratorLogin = await http()
      .post('/api/auth/login')
      .send({ email: 'beta-moderator@example.com', password: PASSWORD })
      .expect(200);
    otherHotelModeratorCookie = (otherModeratorLogin.headers['set-cookie'] as unknown as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }, 180_000);

  beforeEach(async () => {
    await db.collection('hotelBookings').deleteMany({});
    await db.collection('hotelReviews').deleteMany({});
    await db.collection('hotels').updateMany({}, { $set: { averageRating: null, reviewCount: 0 } });
    await db.collection('notifications').deleteMany({ userId: new Types.ObjectId(travelerId) });
    await db.collection('rooms').updateOne({ _id: roomIds.standard }, { $unset: { blockedRanges: '' } });
  });

  afterEach(async () => {
    await db.collection('users').updateOne(
      { _id: new Types.ObjectId(otherTravelerId) },
      { $set: { status: 'ACTIVE' } },
    );
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('requires an authenticated USER and registers the shared hotel booking providers', async () => {
    await http().post('/api/hotel-bookings').send(requestBody(roomIds.standard)).expect(401);
    expect(app.get(BookingProviderRegistry).registeredTypes()).toContain(BookingType.HOTEL);
    expect(app.get(UpcomingBookingsRegistry).registeredTypes()).toContain(BookingType.HOTEL);
  });

  it('creates one reservation for multiple rooms, snapshots prices, totals nights in cents, and holds the rooms', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({
        checkIn: day(2),
        checkOut: day(5),
        rooms: [
          { roomId: roomIds.standard.toHexString(), adults: 2, children: 1 },
          { roomId: roomIds.family.toHexString(), adults: 1, children: 1 },
        ],
      })
      .expect(201);

    expect(response.body).toMatchObject({
      hotelId: hotelId.toHexString(),
      checkIn: day(2),
      checkOut: day(5),
      nights: 3,
      totalCents: 61_500,
      currency: 'USD',
      status: BookingStatus.PENDING_PAYMENT,
      rooms: [
        { roomId: roomIds.standard.toHexString(), adults: 2, children: 1, pricePerNightCents: 8_500, totalCents: 25_500 },
        { roomId: roomIds.family.toHexString(), adults: 1, children: 1, pricePerNightCents: 12_000, totalCents: 36_000 },
      ],
    });
    const expiresAt = new Date(response.body.holdExpiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + HOLD_MINUTES * 60_000);
    expect(await bookingCount()).toBe(1);

    await db.collection('rooms').updateOne({ _id: roomIds.standard }, { $set: { pricePerNightCents: 99_999 } });
    const stored = await db.collection('hotelBookings').findOne({ _id: new Types.ObjectId(response.body.id) });
    expect(stored?.rooms[0].pricePerNightCents).toBe(8_500);

    const available = await http()
      .get(`/api/hotels/${hotelId.toHexString()}/rooms/available`)
      .query({ checkIn: day(2), checkOut: day(5) })
      .expect(200);
    expect(available.body.items.map((item: { roomId: string }) => item.roomId)).not.toEqual(
      expect.arrayContaining([roomIds.standard.toHexString(), roomIds.family.toHexString()]),
    );
  });

  it('rejects a reservation with no adult', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.standard, { adults: 0, children: 1 }))
      .expect(400);
    expect(response.body.details).toContainEqual({ field: 'rooms', message: 'at least one adult is required for the reservation' });
    expect(await bookingCount()).toBe(0);
  });

  it('rejects a room whose assigned guests exceed its maximum occupancy', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.standard, { adults: 2, children: 2 }))
      .expect(400);
    expect(response.body.details[0].field).toBe(`rooms.${roomIds.standard.toHexString()}`);
    expect(await bookingCount()).toBe(0);
  });

  it('rejects more rooms than the hotel search limit', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({
        checkIn: day(2),
        checkOut: day(5),
        rooms: Array.from({ length: HOTEL_SEARCH_MAX_ROOMS + 1 }, () => ({
          roomId: new Types.ObjectId().toHexString(),
          adults: 1,
          children: 0,
        })),
      })
      .expect(400);

    expect(response.body.details).toContainEqual(
      expect.objectContaining({ field: 'rooms', message: expect.stringContaining(`${HOTEL_SEARCH_MAX_ROOMS}`) }),
    );
    expect(await bookingCount()).toBe(0);
  });

  it('rejects rooms from different hotels and inactive or unavailable rooms', async () => {
    const differentHotels = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({
        checkIn: day(2),
        checkOut: day(5),
        rooms: [
          { roomId: roomIds.standard.toHexString(), adults: 1, children: 0 },
          { roomId: roomIds.otherHotel.toHexString(), adults: 1, children: 0 },
        ],
      })
      .expect(400);
    expect(differentHotels.body.details[0].field).toBe('rooms');
    await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.inactive))
      .expect(409);
    expect(await bookingCount()).toBe(0);
  });

  it('rejects invalid date order and check-in dates in the past', async () => {
    const invalidOrder = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({ ...requestBody(roomIds.standard), checkOut: day(2) })
      .expect(400);
    expect(invalidOrder.body.details).toContainEqual({ field: 'checkOut', message: 'checkOut must be after checkIn' });

    const past = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({ ...requestBody(roomIds.standard), checkIn: day(-1) })
      .expect(400);
    expect(past.body.details).toContainEqual({ field: 'checkIn', message: 'checkIn cannot be in the past' });
    expect(await bookingCount()).toBe(0);
  });

  it('rolls back every selected room if any one is already held', async () => {
    await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.standard))
      .expect(201);

    await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({
        checkIn: day(2),
        checkOut: day(5),
        rooms: [
          { roomId: roomIds.standard.toHexString(), adults: 1, children: 0 },
          { roomId: roomIds.family.toHexString(), adults: 1, children: 0 },
        ],
      })
      .expect(409);
    expect(await bookingCount()).toBe(1);

    const available = await http()
      .get(`/api/hotels/${hotelId.toHexString()}/rooms/available`)
      .query({ checkIn: day(2), checkOut: day(5) })
      .expect(200);
    expect(available.body.items.map((item: { roomId: string }) => item.roomId)).toContain(roomIds.family.toHexString());
  });

  it('rejects a confirmed-room overlap without holding the other selected room', async () => {
    const confirmedBooking = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.standard))
      .expect(201);
    const provider = app.get(HotelBookingsService);
    expect(await provider.markConfirmed(confirmedBooking.body.id, 'pi_confirmed_overlap')).toBe(true);

    await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({
        checkIn: day(2),
        checkOut: day(5),
        rooms: [
          { roomId: roomIds.standard.toHexString(), adults: 1, children: 0 },
          { roomId: roomIds.family.toHexString(), adults: 1, children: 0 },
        ],
      })
      .expect(409);

    expect(await bookingCount()).toBe(1);
    const available = await http()
      .get(`/api/hotels/${hotelId.toHexString()}/rooms/available`)
      .query({ checkIn: day(2), checkOut: day(5) })
      .expect(200);
    expect(available.body.items.map((item: { roomId: string }) => item.roomId)).toContain(roomIds.family.toHexString());
    expect(available.body.items.map((item: { roomId: string }) => item.roomId)).not.toContain(roomIds.standard.toHexString());
  });

  it('rejects a blocked room and leaves the other selected room unheld (HTL-18)', async () => {
    await db.collection('rooms').updateOne(
      { _id: roomIds.standard },
      {
        $set: {
          blockedRanges: [{ _id: new Types.ObjectId(), startDate: day(2), endDate: day(4) }],
        },
      },
    );

    await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({
        checkIn: day(2),
        checkOut: day(5),
        rooms: [
          { roomId: roomIds.standard.toHexString(), adults: 1, children: 0 },
          { roomId: roomIds.family.toHexString(), adults: 1, children: 0 },
        ],
      })
      .expect(409);

    expect(await bookingCount()).toBe(0);
    const available = await http()
      .get(`/api/hotels/${hotelId.toHexString()}/rooms/available`)
      .query({ checkIn: day(2), checkOut: day(5) })
      .expect(200);
    expect(available.body.items.map((item: { roomId: string }) => item.roomId)).toContain(roomIds.family.toHexString());
    expect(available.body.items.map((item: { roomId: string }) => item.roomId)).not.toContain(roomIds.standard.toHexString());
  });

  it('allows only one of two parallel holds for the same room', async () => {
    const payload = requestBody(roomIds.standard);
    const responses = await Promise.all([
      http().post('/api/hotel-bookings').set('Cookie', travelerCookie).send(payload),
      http().post('/api/hotel-bookings').set('Cookie', travelerCookie).send(payload),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await bookingCount()).toBe(1);
  });

  it('expires a due hold through BookingLifecycle and makes its room available again', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.standard))
      .expect(201);
    await db.collection('hotelBookings').updateOne(
      { _id: new Types.ObjectId(response.body.id) },
      { $set: { holdExpiresAt: new Date(Date.now() - 60_000) } },
    );

    await lifecycle.sweepExpiredHolds(new Date());
    const stored = await db.collection('hotelBookings').findOne({ _id: new Types.ObjectId(response.body.id) });
    expect(stored?.status).toBe(BookingStatus.EXPIRED);
    const available = await http()
      .get(`/api/hotels/${hotelId.toHexString()}/rooms/available`)
      .query({ checkIn: day(2), checkOut: day(5) })
      .expect(200);
    expect(available.body.items.map((item: { roomId: string }) => item.roomId)).toContain(roomIds.standard.toHexString());
  });

  it('confirms idempotently and reports upcoming confirmed bookings for account deactivation', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({
        checkIn: day(2),
        checkOut: day(5),
        rooms: [
          { roomId: roomIds.standard.toHexString(), adults: 1, children: 0 },
          { roomId: roomIds.family.toHexString(), adults: 1, children: 0 },
        ],
      })
      .expect(201);
    const otherBookingResponse = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.otherHotel))
      .expect(201);
    const provider = app.get(HotelBookingsService);

    expect(await provider.markConfirmed(response.body.id, 'pi_hotel_test')).toBe(true);
    const firstConfirmation = await db.collection('hotelBookings').findOne({ _id: new Types.ObjectId(response.body.id) });
    expect(await provider.markConfirmed(response.body.id, 'pi_hotel_test')).toBe(true);
    expect(await provider.markConfirmed(otherBookingResponse.body.id, 'pi_hotel_other')).toBe(true);
    expect(await provider.hasUpcomingConfirmedBookings(travelerId, new Date())).toBe(true);
    expect(await provider.hasUpcomingConfirmedBookings(travelerId, new Date(`${day(3)}T00:00:00.000Z`))).toBe(false);

    const confirmed = await db.collection('hotelBookings').findOne({ _id: new Types.ObjectId(response.body.id) });
    const otherConfirmed = await db.collection('hotelBookings').findOne({ _id: new Types.ObjectId(otherBookingResponse.body.id) });
    expect(confirmed?.status).toBe(BookingStatus.CONFIRMED);
    expect(confirmed?.rooms).toHaveLength(2);
    expect(confirmed?.bookingReference).toMatch(/^HTL-[A-F0-9]{16}$/);
    expect(confirmed?.bookingReference).toBe(firstConfirmation?.bookingReference);
    expect(otherConfirmed?.bookingReference).toBeTruthy();
    expect(otherConfirmed?.bookingReference).not.toBe(confirmed?.bookingReference);
    expect(confirmed?.holdExpiresAt).toBeUndefined();
    expect(await db.collection('notifications').countDocuments({ userId: new Types.ObjectId(travelerId) })).toBe(2);
  });

  it('shows confirmation to its owner and hides bookings from other users', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.standard))
      .expect(201);
    const provider = app.get(HotelBookingsService);
    expect(await provider.markConfirmed(response.body.id, 'pi_hotel_read')).toBe(true);

    const confirmation = await http()
      .get(`/api/hotel-bookings/${response.body.id}`)
      .set('Cookie', travelerCookie)
      .expect(200);
    expect(confirmation.body).toMatchObject({
      id: response.body.id,
      status: BookingStatus.CONFIRMED,
      bookingReference: expect.stringMatching(/^HTL-[A-F0-9]{16}$/),
      holdExpiresAt: null,
    });

    await http().get(`/api/hotel-bookings/${new Types.ObjectId().toHexString()}`).set('Cookie', travelerCookie).expect(404);
    await http().get(`/api/hotel-bookings/${response.body.id}`).expect(401);

    await http()
      .get(`/api/hotel-bookings/${response.body.id}`)
      .set('Cookie', otherTravelerCookie)
      .expect(404);
  });

  it('completes confirmed stays after checkout via the sweep and owner read', async () => {
    const swept = await completedStayFixture(day(-2));
    const bookings = app.get(HotelBookingsService);

    await expect(bookings.completePastStays(new Date())).resolves.toBe(1);
    expect((await db.collection('hotelBookings').findOne({ _id: swept }))?.status).toBe(BookingStatus.COMPLETED);

    const lazy = await completedStayFixture(day(-1));
    const response = await http()
      .get(`/api/hotel-bookings/${lazy.toHexString()}`)
      .set('Cookie', travelerCookie)
      .expect(200);
    expect(response.body.status).toBe(BookingStatus.COMPLETED);
    expect((await db.collection('hotelBookings').findOne({ _id: lazy }))?.status).toBe(BookingStatus.COMPLETED);
  });

  it('keeps completing later stays when one booking fails unexpectedly in the sweep', async () => {
    const failing = await completedStayFixture(day(-2));
    const later = await completedStayFixture(day(-2));
    const bookings = app.get(HotelBookingsService);
    const transition = jest
      .spyOn(lifecycle, 'transition')
      .mockRejectedValueOnce(new Error('database blip'));
    try {
      await expect(bookings.completePastStays(new Date())).resolves.toBe(1);
    } finally {
      transition.mockRestore();
    }

    expect((await db.collection('hotelBookings').findOne({ _id: failing }))?.status).toBe(BookingStatus.CONFIRMED);
    expect((await db.collection('hotelBookings').findOne({ _id: later }))?.status).toBe(BookingStatus.COMPLETED);

    // The failed stay is picked up by the next run.
    await expect(bookings.completePastStays(new Date())).resolves.toBe(1);
    expect((await db.collection('hotelBookings').findOne({ _id: failing }))?.status).toBe(BookingStatus.COMPLETED);
  });

  it('requires an authenticated traveler for review mutations', async () => {
    const stay = await completedStayFixture();
    const unauthorized = await http()
      .post(`/api/hotel-bookings/${stay.toHexString()}/review`)
      .send({ rating: 5 })
      .expect(401);
    expect(unauthorized.body.statusCode).toBe(401);

    await http()
      .post(`/api/hotel-bookings/${stay.toHexString()}/review`)
      .set('Cookie', adminCookie)
      .send({ rating: 5 })
      .expect(403);
  });

  it('allows one review per completed reservation, validates fields, and recalculates the hotel average', async () => {
    const firstStay = await completedStayFixture(day(-1), 2);
    const secondStay = await completedStayFixture(day(-2));

    const earlyStay = await completedStayFixture(day(1));
    await http()
      .post(`/api/hotel-bookings/${earlyStay.toHexString()}/review`)
      .set('Cookie', travelerCookie)
      .send({ rating: 5 })
      .expect(409);

    const pastNonCompletedStay = await completedStayFixture(day(-2));
    await db.collection('hotelBookings').updateOne(
      { _id: pastNonCompletedStay },
      { $set: { status: BookingStatus.CANCELLED } },
    );
    await http()
      .post(`/api/hotel-bookings/${pastNonCompletedStay.toHexString()}/review`)
      .set('Cookie', travelerCookie)
      .send({ rating: 5 })
      .expect(409);

    const wrongOwner = await http()
      .post(`/api/hotel-bookings/${firstStay.toHexString()}/review`)
      .set('Cookie', otherTravelerCookie)
      .send({ rating: 5 })
      .expect(404);
    expect(wrongOwner.body.statusCode).toBe(404);

    const invalidRating = await http()
      .post(`/api/hotel-bookings/${firstStay.toHexString()}/review`)
      .set('Cookie', travelerCookie)
      .send({ rating: 6 })
      .expect(400);
    expect(invalidRating.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'rating' })]),
    );
    const invalidComment = await http()
      .post(`/api/hotel-bookings/${firstStay.toHexString()}/review`)
      .set('Cookie', travelerCookie)
      .send({ rating: 5, comment: 'x'.repeat(1001) })
      .expect(400);
    expect(invalidComment.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'comment' })]),
    );

    const [created, raced] = await Promise.all([
      http()
        .post(`/api/hotel-bookings/${firstStay.toHexString()}/review`)
        .set('Cookie', travelerCookie)
        .send({ rating: 5, comment: 'Excellent stay' }),
      http()
        .post(`/api/hotel-bookings/${firstStay.toHexString()}/review`)
        .set('Cookie', travelerCookie)
        .send({ rating: 5, comment: 'Excellent stay' }),
    ]);
    expect([created.status, raced.status].sort()).toEqual([201, 409]);

    const secondReview = await http()
      .post(`/api/hotel-bookings/${secondStay.toHexString()}/review`)
      .set('Cookie', travelerCookie)
      .send({ rating: 1 })
      .expect(201);
    expect(secondReview.body.comment).toBe('');
    expect(await db.collection('hotelReviews').countDocuments({})).toBe(2);
    expect(await db.collection('hotels').findOne({ _id: hotelId })).toMatchObject({
      averageRating: 3,
      reviewCount: 2,
    });

    const details = await http().get(`/api/hotels/${hotelId.toHexString()}`).expect(200);
    expect(details.body).toMatchObject({ averageRating: 3, reviewCount: 2 });
    expect(details.body.reviews.map((review: { id: string }) => review.id)).toEqual([
      secondReview.body.id,
      created.status === 201 ? created.body.id : raced.body.id,
    ]);
  });

  it('allows only the review author to edit/delete and recalculates after each change', async () => {
    const firstStay = await completedStayFixture(day(-1), 2);
    const secondStay = await completedStayFixture(day(-2), 1, otherTravelerId);
    const firstReview = await http()
      .post(`/api/hotel-bookings/${firstStay.toHexString()}/review`)
      .set('Cookie', travelerCookie)
      .send({ rating: 5, comment: 'Great' })
      .expect(201);
    const secondReview = await http()
      .post(`/api/hotel-bookings/${secondStay.toHexString()}/review`)
      .set('Cookie', otherTravelerCookie)
      .send({ rating: 1 })
      .expect(201);

    await http()
      .patch(`/api/reviews/${firstReview.body.id}`)
      .set('Cookie', otherTravelerCookie)
      .send({ rating: 2 })
      .expect(404);
    await http()
      .delete(`/api/reviews/${firstReview.body.id}`)
      .set('Cookie', otherTravelerCookie)
      .expect(404);

    const updated = await http()
      .patch(`/api/reviews/${firstReview.body.id}`)
      .set('Cookie', travelerCookie)
      .send({ rating: 3, comment: 'Updated review' })
      .expect(200);
    expect(updated.body).toMatchObject({ id: firstReview.body.id, rating: 3, comment: 'Updated review' });
    expect(await db.collection('hotels').findOne({ _id: hotelId })).toMatchObject({
      averageRating: 2,
      reviewCount: 2,
    });

    await http()
      .delete(`/api/reviews/${secondReview.body.id}`)
      .set('Cookie', otherTravelerCookie)
      .expect(204);
    expect(await db.collection('hotels').findOne({ _id: hotelId })).toMatchObject({
      averageRating: 3,
      reviewCount: 1,
    });
    await http()
      .delete(`/api/reviews/${firstReview.body.id}`)
      .set('Cookie', travelerCookie)
      .expect(204);
    expect(await db.collection('hotels').findOne({ _id: hotelId })).toMatchObject({
      averageRating: null,
      reviewCount: 0,
    });
  });

  it('shows deactivated review authors as Deleted user and excludes hidden reviews', async () => {
    const stay = await completedStayFixture(day(-1), 1, otherTravelerId);
    const review = await http()
      .post(`/api/hotel-bookings/${stay.toHexString()}/review`)
      .set('Cookie', otherTravelerCookie)
      .send({ rating: 4, comment: 'Visible review' })
      .expect(201);

    await db.collection('hotelReviews').insertOne({
      bookingId: new Types.ObjectId(),
      hotelId,
      authorId: new Types.ObjectId(travelerId),
      rating: 1,
      comment: 'Hidden review',
      isHidden: true,
      createdAt: new Date(Date.now() + 1000),
      updatedAt: new Date(),
    });
    await db.collection('users').updateOne(
      { _id: new Types.ObjectId(otherTravelerId) },
      { $set: { status: 'DEACTIVATED' } },
    );

    const details = await http().get(`/api/hotels/${hotelId.toHexString()}`).expect(200);
    expect(details.body).toMatchObject({ averageRating: 4, reviewCount: 1 });
    expect(details.body.reviews).toHaveLength(1);
    expect(details.body.reviews[0]).toMatchObject({
      id: review.body.id,
      authorName: 'Deleted user',
      comment: 'Visible review',
    });
  });

  it('lets the hotel moderator reply to (and edit) a review of their own hotel, visible publicly (HTL-26)', async () => {
    const stay = await completedStayFixture(day(-1), 1);
    const review = await http()
      .post(`/api/hotel-bookings/${stay.toHexString()}/review`)
      .set('Cookie', travelerCookie)
      .send({ rating: 4, comment: 'Lovely stay' })
      .expect(201);

    const replied = await http()
      .post(`/api/reviews/${review.body.id}/reply`)
      .set('Cookie', moderatorCookie)
      .send({ reply: 'Thank you for staying with us!' })
      .expect(200);
    expect(replied.body).toMatchObject({
      id: review.body.id,
      reply: 'Thank you for staying with us!',
    });
    expect(typeof replied.body.repliedAt).toBe('string');

    const details = await http().get(`/api/hotels/${hotelId.toHexString()}`).expect(200);
    expect(details.body.reviews[0]).toMatchObject({
      id: review.body.id,
      reply: 'Thank you for staying with us!',
    });
    const summary = await http().get(`/api/hotels/${hotelId.toHexString()}/reviews`).expect(200);
    expect(summary.body.reviews.items[0]).toMatchObject({
      id: review.body.id,
      reply: 'Thank you for staying with us!',
    });

    const edited = await http()
      .post(`/api/reviews/${review.body.id}/reply`)
      .set('Cookie', moderatorCookie)
      .send({ reply: 'Edited: thanks again!' })
      .expect(200);
    expect(edited.body.reply).toBe('Edited: thanks again!');
  });

  it('rejects a reply from the wrong hotel moderator, a non-moderator, an unknown review, or an empty/over-long reply (HTL-26)', async () => {
    const stay = await completedStayFixture(day(-1), 1);
    const review = await http()
      .post(`/api/hotel-bookings/${stay.toHexString()}/review`)
      .set('Cookie', travelerCookie)
      .send({ rating: 3 })
      .expect(201);

    await http()
      .post(`/api/reviews/${review.body.id}/reply`)
      .set('Cookie', otherHotelModeratorCookie)
      .send({ reply: 'Not your hotel' })
      .expect(403);
    await http()
      .post(`/api/reviews/${review.body.id}/reply`)
      .set('Cookie', travelerCookie)
      .send({ reply: 'A traveler cannot reply' })
      .expect(403);
    await http()
      .post(`/api/reviews/${review.body.id}/reply`)
      .set('Cookie', adminCookie)
      .send({ reply: 'Admin cannot reply either' })
      .expect(403);
    await http()
      .post(`/api/reviews/${new Types.ObjectId().toHexString()}/reply`)
      .set('Cookie', moderatorCookie)
      .send({ reply: 'No such review' })
      .expect(404);
    await http()
      .post(`/api/reviews/${review.body.id}/reply`)
      .set('Cookie', moderatorCookie)
      .send({ reply: '   ' })
      .expect(400);
    await http()
      .post(`/api/reviews/${review.body.id}/reply`)
      .set('Cookie', moderatorCookie)
      .send({ reply: 'x'.repeat(1001) })
      .expect(400);

    const unreplied = await http().get(`/api/hotels/${hotelId.toHexString()}`).expect(200);
    expect(unreplied.body.reviews[0].reply).toBeUndefined();
  });

  it('expires an overdue pending hold when its owner reads the booking', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.standard))
      .expect(201);
    await db.collection('hotelBookings').updateOne(
      { _id: new Types.ObjectId(response.body.id) },
      { $set: { holdExpiresAt: new Date(Date.now() - 60_000) } },
    );

    const booking = await http()
      .get(`/api/hotel-bookings/${response.body.id}`)
      .set('Cookie', travelerCookie)
      .expect(200);

    expect(booking.body).toMatchObject({
      id: response.body.id,
      status: BookingStatus.EXPIRED,
      holdExpiresAt: null,
    });
    const stored = await db
      .collection('hotelBookings')
      .findOne({ _id: new Types.ObjectId(response.body.id) });
    expect(stored?.status).toBe(BookingStatus.EXPIRED);
    expect(stored?.holdExpiresAt).toBeUndefined();
  });

  it('confirms a paid hotel hold through BookingLifecycle without a Stripe event object', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send({
        checkIn: day(2),
        checkOut: day(5),
        rooms: [
          { roomId: roomIds.standard.toHexString(), adults: 1, children: 0 },
          { roomId: roomIds.family.toHexString(), adults: 1, children: 0 },
        ],
      })
      .expect(201);
    await db.collection('hotelBookings').updateOne(
      { _id: new Types.ObjectId(response.body.id) },
      { $set: { holdExpiresAt: new Date(Date.now() - 60_000) } },
    );
    const paidLifecycle = new BookingLifecycle(app.get(BookingProviderRegistry), {
      prepareExpiry: async () => ({ outcome: 'PAID', paymentRef: 'pi_late_hotel' }),
    });

    await expect(paidLifecycle.expireIfDue(BookingType.HOTEL, response.body.id, new Date())).resolves.toBe(true);
    const confirmation = await http()
      .get(`/api/hotel-bookings/${response.body.id}`)
      .set('Cookie', travelerCookie)
      .expect(200);
    expect(confirmation.body.status).toBe(BookingStatus.CONFIRMED);
    expect(confirmation.body.bookingReference).toMatch(/^HTL-[A-F0-9]{16}$/);
    expect(confirmation.body.rooms).toHaveLength(2);
    expect(await db.collection('notifications').countDocuments({ userId: new Types.ObjectId(travelerId) })).toBe(1);
  });

  it('provides payable details and hotel policies to Payments, scoped to the booking owner', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.standard))
      .expect(201);
    const provider = app.get(HotelBookingsService);

    await expect(provider.getPayable(response.body.id, travelerId)).resolves.toEqual({
      amountCents: response.body.totalCents,
      currency: response.body.currency,
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date(response.body.holdExpiresAt),
    });
    await expect(provider.getPayable(response.body.id, new Types.ObjectId().toHexString())).resolves.toBeNull();
    await expect(provider.getPayable('not-an-object-id', travelerId)).resolves.toBeNull();
    await expect(provider.getPayable(new Types.ObjectId().toHexString(), travelerId)).resolves.toBeNull();

    await expect(provider.getPolicies(response.body.id)).resolves.toEqual({
      ownerId: travelerId,
      cancellationTiers: [{ daysBeforeThreshold: 7, refundPercent: 50 }],
      checkInTime: '15:00',
      checkOutTime: '11:00',
    });
    await expect(provider.getPolicies('not-an-object-id')).resolves.toBeNull();
    await expect(provider.getPolicies(new Types.ObjectId().toHexString())).resolves.toBeNull();
  });

  it('documents the endpoint in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    expect(response.body.paths['/api/hotel-bookings'].post.summary).toContain('HTL-18');
    expect(response.body.paths['/api/hotel-bookings/{id}'].get.summary).toContain('HTL-17');
    expect(response.body.paths['/api/hotel-bookings/{id}/review'].post.summary).toContain('HTL-23');
    expect(response.body.paths['/api/reviews/{id}'].patch.summary).toContain('HTL-23');
    expect(response.body.paths['/api/reviews/{id}'].delete.summary).toContain('HTL-23');
  });
});
