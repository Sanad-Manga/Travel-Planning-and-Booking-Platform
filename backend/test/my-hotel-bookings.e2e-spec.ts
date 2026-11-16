import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { BookingStatus, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { HotelBooking } from '../src/hotels/schemas/hotel-booking.schema';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

const DAY_MS = 86_400_000;
const day = (offset: number): string =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const minutesFromNow = (minutes: number): Date =>
  new Date(Date.now() + minutes * 60_000);

describe('my hotel reservations (HTL-20) over HTTP', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;
  const jwt = new JwtService({ secret: TEST_ACCESS_SECRET });
  const cookies = { traveler: '', other: '', admin: '', moderator: '' };
  const ids = { traveler: new Types.ObjectId(), other: new Types.ObjectId() };
  const hotelId = new Types.ObjectId();
  const roomA = new Types.ObjectId();
  const roomB = new Types.ObjectId();
  const http = () => request(app.getHttpServer());

  async function account(
    role: Role,
    _id = new Types.ObjectId(),
  ): Promise<string> {
    await db.collection('users').insertOne({
      _id,
      name: `${role} account`,
      email: `${_id.toHexString()}@mine.test`,
      passwordHash: 'x',
      role,
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await jwt.signAsync(
      { sub: _id.toHexString(), role },
      { expiresIn: '30m' },
    );
    return `access_token=${token}`;
  }

  /** A stored reservation of the traveler unless `userId` says otherwise. */
  async function booking(extra: Record<string, unknown> = {}): Promise<string> {
    const _id = new Types.ObjectId();
    const document: Record<string, unknown> = {
      _id,
      userId: ids.traveler,
      hotelId,
      checkIn: day(10),
      checkOut: day(12),
      nights: 2,
      rooms: [
        {
          roomId: roomA,
          adults: 2,
          children: 1,
          name: '101',
          type: 'Double',
          maxOccupancy: 3,
          pricePerNightCents: 8_500,
          totalCents: 17_000,
        },
        {
          roomId: roomB,
          adults: 1,
          children: 0,
          name: '202',
          type: 'Single',
          maxOccupancy: 2,
          pricePerNightCents: 5_000,
          totalCents: 10_000,
        },
      ],
      totalCents: 27_000,
      currency: 'USD',
      status: BookingStatus.CONFIRMED,
      paymentRef: 'pi_secret_reference',
      bookingReference: `HTL-${_id.toHexString().slice(-8).toUpperCase()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    };
    // `undefined` means "leave the field out": the driver would store null, and null breaks the unique bookingReference index.
    for (const key of Object.keys(document))
      if (document[key] === undefined) delete document[key];
    await db.collection('hotelBookings').insertOne(document);
    return _id.toHexString();
  }

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
        (await import('../src/hotels/hotels.module')).HotelsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    await db.model('User').init();
    await db.model(HotelBooking.name).init(); // the unique bookingReference index must exist before the tests insert

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
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    cookies.traveler = await account(Role.USER, ids.traveler);
    cookies.other = await account(Role.USER, ids.other);
    cookies.admin = await account(Role.ADMIN);
    cookies.moderator = await account(Role.HOTEL_MODERATOR);
  }, 180_000);

  beforeEach(async () => {
    await db.collection('hotelBookings').deleteMany({});
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('who can call it', () => {
    it('answers 401 without a login on both routes', async () => {
      await http().get('/api/hotel-bookings').expect(401);
      await http()
        .get(`/api/hotel-bookings/${new Types.ObjectId().toHexString()}`)
        .expect(401);
    });

    it('answers 403 to an admin and to a hotel moderator: it is for travelers', async () => {
      const id = await booking();
      for (const cookie of [cookies.admin, cookies.moderator]) {
        await http()
          .get('/api/hotel-bookings')
          .set('Cookie', cookie)
          .expect(403);
        await http()
          .get(`/api/hotel-bookings/${id}`)
          .set('Cookie', cookie)
          .expect(403);
      }
    });
  });

  describe('GET /api/hotel-bookings (grouped list)', () => {
    /** One reservation for every group rule. Returns the ids by name. */
    async function seedAllGroups() {
      return {
        upcoming: await booking({ checkIn: day(10), checkOut: day(12) }),
        ongoing: await booking({ checkIn: day(-1), checkOut: day(2) }),
        endsToday: await booking({ checkIn: day(-2), checkOut: day(0) }),
        endedLongAgo: await booking({ checkIn: day(-30), checkOut: day(-28) }),
        completed: await booking({
          status: BookingStatus.COMPLETED,
          checkIn: day(-20),
          checkOut: day(-18),
        }),
        cancelled: await booking({ status: BookingStatus.CANCELLED }),
        expired: await booking({
          status: BookingStatus.EXPIRED,
          bookingReference: undefined,
          paymentRef: undefined,
        }),
        pendingLive: await booking({
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: minutesFromNow(10),
          bookingReference: undefined,
          paymentRef: undefined,
        }),
        pendingLapsed: await booking({
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: minutesFromNow(-10),
          bookingReference: undefined,
          paymentRef: undefined,
        }),
      };
    }
    const idsOf = (body: { items: { id: string }[] }) =>
      body.items.map((item) => item.id);

    it('returns the page envelope, empty when the traveler has no reservation', async () => {
      const response = await http()
        .get('/api/hotel-bookings')
        .set('Cookie', cookies.traveler)
        .expect(200);
      expect(response.body).toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('puts every reservation in exactly one group', async () => {
      const seeded = await seedAllGroups();

      const upcoming = await http()
        .get('/api/hotel-bookings')
        .query({ group: 'UPCOMING' })
        .set('Cookie', cookies.traveler)
        .expect(200);
      const past = await http()
        .get('/api/hotel-bookings')
        .query({ group: 'PAST' })
        .set('Cookie', cookies.traveler)
        .expect(200);
      const cancelled = await http()
        .get('/api/hotel-bookings')
        .query({ group: 'CANCELLED' })
        .set('Cookie', cookies.traveler)
        .expect(200);

      expect(new Set(idsOf(upcoming.body))).toEqual(
        new Set([seeded.upcoming, seeded.ongoing, seeded.pendingLive]),
      );
      expect(new Set(idsOf(past.body))).toEqual(
        new Set([seeded.endsToday, seeded.endedLongAgo, seeded.completed]),
      );
      expect(new Set(idsOf(cancelled.body))).toEqual(
        new Set([seeded.cancelled, seeded.expired, seeded.pendingLapsed]),
      );
      expect(upcoming.body.total + past.body.total + cancelled.body.total).toBe(
        Object.keys(seeded).length,
      );
      expect(
        upcoming.body.items.every(
          (item: { group: string }) => item.group === 'UPCOMING',
        ),
      ).toBe(true);
      expect(
        past.body.items.every(
          (item: { group: string }) => item.group === 'PAST',
        ),
      ).toBe(true);
      expect(
        cancelled.body.items.every(
          (item: { group: string }) => item.group === 'CANCELLED',
        ),
      ).toBe(true);
    });

    it('lists all reservations, each with its group, when no group is asked for', async () => {
      const seeded = await seedAllGroups();
      const response = await http()
        .get('/api/hotel-bookings')
        .query({ limit: 50 })
        .set('Cookie', cookies.traveler)
        .expect(200);

      expect(response.body.total).toBe(Object.keys(seeded).length);
      const groupOfId = Object.fromEntries(
        response.body.items.map((item: { id: string; group: string }) => [
          item.id,
          item.group,
        ]),
      );
      expect(groupOfId[seeded.upcoming]).toBe('UPCOMING');
      expect(groupOfId[seeded.ongoing]).toBe('UPCOMING');
      expect(groupOfId[seeded.endsToday]).toBe('PAST');
      expect(groupOfId[seeded.pendingLapsed]).toBe('CANCELLED');
    });

    it("never lists another traveler's reservations", async () => {
      await booking({ userId: ids.other });
      const mine = await booking();

      const response = await http()
        .get('/api/hotel-bookings')
        .set('Cookie', cookies.traveler)
        .expect(200);
      expect(idsOf(response.body)).toEqual([mine]);
      const theirs = await http()
        .get('/api/hotel-bookings')
        .set('Cookie', cookies.other)
        .expect(200);
      expect(theirs.body.total).toBe(1);
    });

    it('shows reference, hotel, rooms, dates, guests, total and status on each row, and no payment data', async () => {
      const id = await booking();
      const response = await http()
        .get('/api/hotel-bookings')
        .set('Cookie', cookies.traveler)
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      const row = response.body.items[0];
      expect(row).toEqual({
        id,
        bookingReference: expect.stringMatching(/^HTL-/),
        hotel: {
          id: hotelId.toHexString(),
          name: 'Nile Palace',
          cityId: 'CAI',
        },
        checkIn: day(10),
        checkOut: day(12),
        nights: 2,
        rooms: [
          {
            roomId: roomA.toHexString(),
            name: '101',
            type: 'Double',
            adults: 2,
            children: 1,
          },
          {
            roomId: roomB.toHexString(),
            name: '202',
            type: 'Single',
            adults: 1,
            children: 0,
          },
        ],
        guests: { adults: 3, children: 1 },
        totalCents: 27_000,
        currency: 'USD',
        status: BookingStatus.CONFIRMED,
        group: 'UPCOMING',
      });
      expect(JSON.stringify(response.body)).not.toContain(
        'pi_secret_reference',
      );
    });

    it('shows when the hold of a reservation waiting for payment ends', async () => {
      const holdExpiresAt = minutesFromNow(10);
      await booking({
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt,
        bookingReference: undefined,
        paymentRef: undefined,
      });
      const response = await http()
        .get('/api/hotel-bookings')
        .set('Cookie', cookies.traveler)
        .expect(200);

      expect(response.body.items[0].holdExpiresAt).toBe(
        holdExpiresAt.toISOString(),
      );
      expect(response.body.items[0].bookingReference).toBeUndefined();
    });

    it('still shows the hotel name when the hotel was deactivated', async () => {
      const gone = new Types.ObjectId();
      await db.collection('hotels').insertOne({
        _id: gone,
        name: 'Closed Inn',
        nameKey: 'closed inn',
        address: '2 Test Street',
        cityId: 'CAI',
        countryCode: 'EG',
        description: 'Hotel.',
        photos: [],
        starRating: 3,
        amenities: [],
        cancellationTiers: [],
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await booking({ hotelId: gone });

      const response = await http()
        .get('/api/hotel-bookings')
        .set('Cookie', cookies.traveler)
        .expect(200);
      expect(response.body.items[0].hotel).toEqual({
        id: gone.toHexString(),
        name: 'Closed Inn',
        cityId: 'CAI',
      });
    });

    it('does not fail when the hotel record is missing: the row keeps its hotel id and shows a placeholder name', async () => {
      const missing = new Types.ObjectId();
      const id = await booking({ hotelId: missing });

      const list = await http()
        .get('/api/hotel-bookings')
        .set('Cookie', cookies.traveler)
        .expect(200);
      expect(list.body.items[0].hotel).toEqual({
        id: missing.toHexString(),
        name: 'Hotel no longer listed',
        cityId: null,
      });

      const details = await http()
        .get(`/api/hotel-bookings/${id}`)
        .set('Cookie', cookies.traveler)
        .expect(200);
      expect(details.body.hotel).toEqual({
        id: missing.toHexString(),
        name: 'Hotel no longer listed',
        address: null,
        cityId: null,
        checkInTime: null,
        checkOutTime: null,
      });
    });

    it('orders upcoming by check-in (soonest first) and past by check-out (latest first)', async () => {
      const later = await booking({ checkIn: day(30), checkOut: day(32) });
      const sooner = await booking({ checkIn: day(5), checkOut: day(7) });
      const oldest = await booking({ checkIn: day(-30), checkOut: day(-28) });
      const recent = await booking({ checkIn: day(-9), checkOut: day(-7) });

      const upcoming = await http()
        .get('/api/hotel-bookings')
        .query({ group: 'UPCOMING' })
        .set('Cookie', cookies.traveler)
        .expect(200);
      const past = await http()
        .get('/api/hotel-bookings')
        .query({ group: 'PAST' })
        .set('Cookie', cookies.traveler)
        .expect(200);

      expect(idsOf(upcoming.body)).toEqual([sooner, later]);
      expect(idsOf(past.body)).toEqual([recent, oldest]);
    });

    it('pages with page and limit', async () => {
      for (let i = 0; i < 5; i += 1)
        await booking({ checkIn: day(10 + i), checkOut: day(12 + i) });

      const first = await http()
        .get('/api/hotel-bookings')
        .query({ group: 'UPCOMING', page: 1, limit: 2 })
        .set('Cookie', cookies.traveler)
        .expect(200);
      const last = await http()
        .get('/api/hotel-bookings')
        .query({ group: 'UPCOMING', page: 3, limit: 2 })
        .set('Cookie', cookies.traveler)
        .expect(200);

      expect(first.body).toMatchObject({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
      expect(first.body.items).toHaveLength(2);
      expect(last.body.items).toHaveLength(1);
      expect(new Set([...idsOf(first.body), ...idsOf(last.body)]).size).toBe(3);
    });

    it('answers 400 on the broken field for a bad group, page or limit', async () => {
      const group = await http()
        .get('/api/hotel-bookings')
        .query({ group: 'SOMEDAY' })
        .set('Cookie', cookies.traveler)
        .expect(400);
      expect(group.body.details).toEqual([
        { field: 'group', message: expect.stringContaining('UPCOMING') },
      ]);

      const page = await http()
        .get('/api/hotel-bookings')
        .query({ page: 0 })
        .set('Cookie', cookies.traveler)
        .expect(400);
      expect(page.body.details[0].field).toBe('page');
      const limit = await http()
        .get('/api/hotel-bookings')
        .query({ limit: 51 })
        .set('Cookie', cookies.traveler)
        .expect(400);
      expect(limit.body.details[0].field).toBe('limit');
    });
  });

  describe('GET /api/hotel-bookings/:id (details)', () => {
    it('returns the full reservation for its owner', async () => {
      const id = await booking();
      const response = await http()
        .get(`/api/hotel-bookings/${id}`)
        .set('Cookie', cookies.traveler)
        .expect(200);

      expect(response.body).toEqual({
        id,
        bookingReference: expect.stringMatching(/^HTL-/),
        hotel: {
          id: hotelId.toHexString(),
          name: 'Nile Palace',
          address: '1 Corniche Street',
          cityId: 'CAI',
          checkInTime: '15:00',
          checkOutTime: '11:00',
        },
        checkIn: day(10),
        checkOut: day(12),
        nights: 2,
        rooms: [
          {
            roomId: roomA.toHexString(),
            name: '101',
            type: 'Double',
            adults: 2,
            children: 1,
            maxOccupancy: 3,
            pricePerNightCents: 8_500,
            totalCents: 17_000,
          },
          {
            roomId: roomB.toHexString(),
            name: '202',
            type: 'Single',
            adults: 1,
            children: 0,
            maxOccupancy: 2,
            pricePerNightCents: 5_000,
            totalCents: 10_000,
          },
        ],
        guests: { adults: 3, children: 1 },
        totalCents: 27_000,
        currency: 'USD',
        status: BookingStatus.CONFIRMED,
        group: 'UPCOMING',
        refund: null,
        createdAt: expect.any(String),
      });
      expect(JSON.stringify(response.body)).not.toContain(
        'pi_secret_reference',
      );
    });

    it('shows the hold end of a reservation waiting for payment', async () => {
      const holdExpiresAt = minutesFromNow(10);
      const id = await booking({
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt,
        bookingReference: undefined,
        paymentRef: undefined,
      });
      const response = await http()
        .get(`/api/hotel-bookings/${id}`)
        .set('Cookie', cookies.traveler)
        .expect(200);

      expect(response.body).toMatchObject({
        status: BookingStatus.PENDING_PAYMENT,
        group: 'UPCOMING',
        holdExpiresAt: holdExpiresAt.toISOString(),
      });
    });

    it('opens a cancelled reservation, in the CANCELLED group', async () => {
      const id = await booking({ status: BookingStatus.CANCELLED });
      const response = await http()
        .get(`/api/hotel-bookings/${id}`)
        .set('Cookie', cookies.traveler)
        .expect(200);

      expect(response.body).toMatchObject({
        status: BookingStatus.CANCELLED,
        group: 'CANCELLED',
      });
    });

    it("answers 404 for someone else's reservation, the same as for an unknown one", async () => {
      const theirs = await booking({ userId: ids.other });

      const notMine = await http()
        .get(`/api/hotel-bookings/${theirs}`)
        .set('Cookie', cookies.traveler)
        .expect(404);
      const unknown = await http()
        .get(`/api/hotel-bookings/${new Types.ObjectId().toHexString()}`)
        .set('Cookie', cookies.traveler)
        .expect(404);
      expect(notMine.body.message).toBe(unknown.body.message);
    });

    it('answers 400 on id for a malformed id', async () => {
      const response = await http()
        .get('/api/hotel-bookings/not-an-id')
        .set('Cookie', cookies.traveler)
        .expect(400);
      expect(response.body.details).toEqual([
        { field: 'id', message: 'id must be a valid id' },
      ]);
    });
  });

  describe('Swagger', () => {
    it('documents both routes, the group filter and the answers', async () => {
      const response = await http().get('/api/docs-json').expect(200);
      const list = response.body.paths['/api/hotel-bookings'].get;
      const details = response.body.paths['/api/hotel-bookings/{id}'].get;

      expect(list.parameters.map((p: { name: string }) => p.name)).toEqual(
        expect.arrayContaining(['group', 'page', 'limit']),
      );
      expect(Object.keys(list.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403']),
      );
      expect(Object.keys(details.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '404']),
      );
    });
  });
});
