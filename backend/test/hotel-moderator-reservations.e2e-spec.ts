import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { BookingStatus, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { HotelBooking } from '../src/hotels/schemas/hotel-booking.schema';
import { buildSwaggerDocument, setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';

describe('hotel moderator reservations (HTL-22) over HTTP', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;

  const hotelId = new Types.ObjectId();
  const otherHotelId = new Types.ObjectId();
  const emptyHotelId = new Types.ObjectId();
  const travelerId = new Types.ObjectId();
  const secondTravelerId = new Types.ObjectId();

  const bookingIds: Types.ObjectId[] = [];
  let moderatorCookie: string;
  let otherModeratorCookie: string;
  let emptyHotelModeratorCookie: string;
  let travelerCookie: string;

  const http = () => request(app.getHttpServer());
  const getReservations = (id: Types.ObjectId | string, cookie?: string, query = '') =>
    http()
      .get(`/api/hotels/${id.toString()}/reservations${query ? `?${query}` : ''}`)
      .set('Cookie', cookie ?? moderatorCookie);

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
    cancellationTiers: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const user = (
    id: Types.ObjectId,
    name: string,
    email: string,
    role: Role,
    hotel?: Types.ObjectId,
  ) => ({
    _id: id,
    name,
    email,
    passwordHash: hashSync(PASSWORD, 4),
    role,
    status: 'ACTIVE',
    consentAcceptedAt: new Date(),
    preferredCurrency: 'USD',
    ...(hotel ? { hotelId: hotel } : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const booking = (ownerHotelId: Types.ObjectId, guestId: Types.ObjectId, index: number, overrides: Record<string, unknown> = {}) => ({
    userId: guestId,
    hotelId: ownerHotelId,
    checkIn: '2027-03-10',
    checkOut: '2027-03-13',
    rooms: [
      {
        roomId: new Types.ObjectId(),
        adults: 1,
        children: 0,
        name: 'Standard',
        type: 'Double',
        maxOccupancy: 2,
        pricePerNightCents: 8_500,
        totalCents: 25_500,
      },
    ],
    nights: 3,
    totalCents: 25_500,
    currency: 'USD',
    status: BookingStatus.CONFIRMED,
    bookingReference: `HTL-${String(index).padStart(16, '0')}`,
    createdAt: new Date(Date.now() - index * 1_000),
    updatedAt: new Date(),
    ...overrides,
  });

  async function login(email: string): Promise<string> {
    const response = await http()
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return (response.headers['set-cookie'] as unknown as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }

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
    await app.init();
    db = app.get<Connection>(getConnectionToken());

    await db.model('User').init();
    await db.model(HotelBooking.name).init();

    await db.collection('hotels').insertMany([
      hotel(hotelId, 'Alpha'),
      hotel(otherHotelId, 'Beta'),
      hotel(emptyHotelId, 'Gamma'),
    ]);
    await db.collection('users').insertMany([
      user(travelerId, 'Mona Adel', 'mona@example.com', Role.USER),
      user(secondTravelerId, 'Omar Said', 'omar@example.com', Role.USER),
      user(new Types.ObjectId(), 'Alpha Moderator', 'alpha-moderator@example.com', Role.HOTEL_MODERATOR, hotelId),
      user(new Types.ObjectId(), 'Beta Moderator', 'beta-moderator@example.com', Role.HOTEL_MODERATOR, otherHotelId),
      user(new Types.ObjectId(), 'Gamma Moderator', 'gamma-moderator@example.com', Role.HOTEL_MODERATOR, emptyHotelId),
    ]);

    const now = new Date();
    const rows = Array.from({ length: 12 }, (_v, index) => {
      const id = new Types.ObjectId();
      bookingIds.push(id);
      const guestId = index % 2 === 0 ? travelerId : secondTravelerId;
      const pending = index === 11;
      return {
        _id: id,
        ...booking(hotelId, guestId, index, {
          createdAt: new Date(now.getTime() - index * 1_000),
          ...(pending
            ? {
                status: BookingStatus.PENDING_PAYMENT,
                bookingReference: undefined,
                holdExpiresAt: new Date(now.getTime() + 10 * 60_000),
              }
            : {}),
        }),
      };
    });
    await db.collection('hotelBookings').insertMany(rows);
    await db.collection('hotelBookings').insertMany([
      booking(otherHotelId, secondTravelerId, 100),
      booking(otherHotelId, secondTravelerId, 101),
      booking(otherHotelId, secondTravelerId, 102),
    ]);

    travelerCookie = await login('mona@example.com');
    moderatorCookie = await login('alpha-moderator@example.com');
    otherModeratorCookie = await login('beta-moderator@example.com');
    emptyHotelModeratorCookie = await login('gamma-moderator@example.com');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('success', () => {
    it('lists only my hotel reservations, newest first, with guest, dates and status', async () => {
      const response = await getReservations(hotelId).expect(200);

      expect(Object.keys(response.body as object).sort()).toEqual([
        'items',
        'limit',
        'page',
        'total',
        'totalPages',
      ]);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(10);
      expect(response.body.total).toBe(12);
      expect(response.body.totalPages).toBe(2);
      expect(response.body.items).toHaveLength(10);

      const first = response.body.items[0];
      expect(Object.keys(first as object).sort()).toEqual([
        'bookingReference',
        'checkIn',
        'checkOut',
        'guest',
        'id',
        'status',
      ]);
      expect(Object.keys(first.guest as object).sort()).toEqual(['name', 'userId']);
      expect(first.id).toBe(bookingIds[0].toString());
      expect(first.guest).toEqual({ userId: travelerId.toString(), name: 'Mona Adel' });
      expect(first.checkIn).toBe('2027-03-10');
      expect(first.checkOut).toBe('2027-03-13');
      expect(first.status).toBe(BookingStatus.CONFIRMED);
      expect(first.bookingReference).toBe('HTL-0000000000000000');
    });

    it('never leaks a pending hold reference and shows the second guest name', async () => {
      const response = await getReservations(hotelId, undefined, 'page=2&limit=10').expect(200);

      expect(response.body.items).toHaveLength(2);
      const pending = response.body.items[1];
      expect(pending.id).toBe(bookingIds[11].toString());
      expect(pending.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(pending.bookingReference).toBeNull();
      expect(pending.guest).toEqual({ userId: secondTravelerId.toString(), name: 'Omar Said' });
    });

    it('limit 50 returns every reservation of the hotel on one page', async () => {
      const response = await getReservations(hotelId, undefined, 'limit=50').expect(200);
      expect(response.body.items).toHaveLength(12);
      expect(response.body.totalPages).toBe(1);
    });

    it('returns an empty page for a hotel that has no reservations', async () => {
      const response = await getReservations(emptyHotelId, emptyHotelModeratorCookie).expect(200);
      expect(response.body).toMatchObject({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
    });
  });

  describe('authorization', () => {
    it('rejects a guest with 401', async () => {
      await http().get(`/api/hotels/${hotelId.toString()}/reservations`).expect(401);
    });

    it('rejects a traveler with 403', async () => {
      await getReservations(hotelId, travelerCookie).expect(403);
    });

    it('rejects a moderator of another hotel with 403', async () => {
      const response = await getReservations(hotelId, otherModeratorCookie).expect(403);
      expect(response.body.message).toBe('You can only view reservations for your own hotel');
    });

    it('answers 403 for an unknown hotel id, like the other moderator-only hotel routes', async () => {
      await getReservations(new Types.ObjectId()).expect(403);
    });
  });

  describe('validation', () => {
    it.each([
      ['page=0', 'page'],
      ['page=abc', 'page'],
      ['page=1.5', 'page'],
      ['limit=51', 'limit'],
      ['limit=0', 'limit'],
      ['limit=abc', 'limit'],
    ])('%s is a field-level 400', async (query, field) => {
      const response = await getReservations(hotelId, undefined, query).expect(400);
      expect((response.body as { details: { field: string }[] }).details.map((detail) => detail.field)).toContain(field);
    });
  });

  describe('swagger', () => {
    it('documents the route with cookie auth, paging and the 200/400/403 responses', () => {
      const operation = buildSwaggerDocument(app).paths['/api/hotels/{id}/reservations']?.get;
      expect(operation).toBeDefined();
      expect(operation!.security).toEqual([{ cookie: [] }]);
      expect((operation!.parameters ?? []).map((parameter) => ('name' in parameter ? parameter.name : ''))).toEqual(
        expect.arrayContaining(['id', 'page', 'limit']),
      );
      expect(operation!.responses['200']).toBeDefined();
      expect(operation!.responses['400']).toBeDefined();
      expect(operation!.responses['403']).toBeDefined();
    });
  });
});
