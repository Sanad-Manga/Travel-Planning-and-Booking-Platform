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
  let lifecycle: BookingLifecycle;

  const roomIds = {
    standard: new Types.ObjectId(),
    family: new Types.ObjectId(),
    otherHotel: new Types.ObjectId(),
    inactive: new Types.ObjectId(),
  };
  const http = () => request(app.getHttpServer());
  const bookingCount = () => db.collection('hotelBookings').countDocuments();
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
  }, 180_000);

  beforeEach(async () => {
    await db.collection('hotelBookings').deleteMany({});
    await db.collection('rooms').updateOne({ _id: roomIds.standard }, { $unset: { blockedRanges: '' } });
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
      .send(requestBody(roomIds.standard))
      .expect(201);
    const provider = app.get(HotelBookingsService);

    expect(await provider.markConfirmed(response.body.id, 'pi_hotel_test')).toBe(true);
    expect(await provider.markConfirmed(response.body.id, 'pi_hotel_test')).toBe(true);
    expect(await provider.hasUpcomingConfirmedBookings(travelerId, new Date())).toBe(true);
    expect(await provider.hasUpcomingConfirmedBookings(travelerId, new Date(`${day(3)}T00:00:00.000Z`))).toBe(false);
    expect(await db.collection('notifications').countDocuments({ userId: new Types.ObjectId(travelerId) })).toBe(1);
  });

  it('provides booking ownership and hotel policies to Payments, and returns null for unknown ids', async () => {
    const response = await http()
      .post('/api/hotel-bookings')
      .set('Cookie', travelerCookie)
      .send(requestBody(roomIds.standard))
      .expect(201);
    const provider = app.get(HotelBookingsService);

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
  });
});
