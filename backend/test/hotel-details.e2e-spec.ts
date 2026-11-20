import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import configuration from '../src/config/configuration';
import { HotelsModule } from '../src/hotels/hotels.module';
import { RoomReservations } from '../src/hotels/room-reservations';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

/** Dates relative to today (UTC), so the "not in the past" rule never makes the test data stale. */
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('HTL-02 hotel details page (e2e, real MongoDB)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;

  // Test double for Hessain's reservations (HTL-16/18): ids in this set count as reserved or held.
  const reserved = new Set<string>();
  const findReservedRoomIds = jest.fn(async (ids: string[]) => new Set(ids.filter((id) => reserved.has(id))));

  const http = () => request(app.getHttpServer());
  const details = (hotelId: Types.ObjectId | string, params: Record<string, string | number> = {}) => {
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return http().get(`/api/hotels/${String(hotelId)}${qs ? `?${qs}` : ''}`);
  };
  /** Stay of 3 nights d2, d3, d4 (check-out d5). */
  const stay = { checkIn: day(2), checkOut: day(5) };
  const fields = (body: { details: Array<{ field: string }> }) => body.details.map((d) => d.field);

  const ids = { full: new Types.ObjectId(), bare: new Types.ObjectId(), off: new Types.ObjectId() };
  const rooms: Record<string, Types.ObjectId> = {};

  const hotel = (_id: Types.ObjectId, name: string, extra: Record<string, unknown> = {}) => ({
    _id,
    name,
    nameKey: name.toLowerCase(),
    address: '12 Corniche El Nil',
    cityId: 'CAI',
    countryCode: 'EG',
    description: 'A hotel on the Nile.',
    photos: [],
    starRating: 4,
    amenities: [],
    cancellationTiers: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  });
  const room = (key: string, hotelId: Types.ObjectId, pricePerNightCents: number, extra: { isActive?: boolean } = {}) => {
    rooms[key] = new Types.ObjectId();
    return {
      _id: rooms[key],
      hotelId,
      name: key,
      nameKey: key,
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNightCents,
      isActive: extra.isActive ?? true,
      availability: [{ _id: new Types.ObjectId(), startDate: day(1), endDate: day(10) }],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
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
        HotelsModule,
      ],
    })
      .overrideProvider(RoomReservations)
      .useValue({ hasConfirmedReservation: async () => false, findReservedRoomIds })
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());

    await db.collection('hotels').insertMany([
      hotel(ids.full, 'Nile View Hotel', {
        photos: [
          { id: 'p1', url: '/uploads/p1.jpg' },
          { id: 'p2', url: '/uploads/p2.jpg' },
        ],
        amenities: ['wifi', 'pool'],
        checkInTime: '14:00',
        checkOutTime: '11:00',
        // Stored largest threshold first (HotelsService.updatePolicies sorts them before saving).
        cancellationTiers: [
          { daysBeforeThreshold: 7, refundPercent: 100 },
          { daysBeforeThreshold: 2, refundPercent: 50 },
        ],
      }),
      hotel(ids.bare, 'Bare Hotel'), // times never set, no tiers, no photos, no amenities
      hotel(ids.off, 'Closed Hotel', { isActive: false, checkInTime: '15:00' }),
    ]);
    await db.collection('rooms').insertMany([
      room('b-double', ids.full, 8_501),
      room('a-double', ids.full, 8_501),
      room('cheap', ids.full, 5_000),
      room('reserved', ids.full, 6_000),
      room('inactive', ids.full, 4_000, { isActive: false }),
      room('bare-1', ids.bare, 1_000),
      room('off-1', ids.off, 1_000),
    ]);
  }, 120_000);

  beforeEach(() => {
    reserved.clear();
    reserved.add(rooms['reserved'].toHexString());
    findReservedRoomIds.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('happy path as a guest (no login, no cookie)', () => {
    it('shows the profile, photos, amenities, check-in/out times, cancellation policy, rating and reviews', async () => {
      const res = await details(ids.full).expect(200);
      expect(res.body).toEqual({
        id: ids.full.toHexString(),
        name: 'Nile View Hotel',
        address: '12 Corniche El Nil',
        cityId: 'CAI',
        countryCode: 'EG',
        description: 'A hotel on the Nile.',
        photos: [
          { id: 'p1', url: '/uploads/p1.jpg' },
          { id: 'p2', url: '/uploads/p2.jpg' },
        ],
        starRating: 4,
        amenities: ['wifi', 'pool'],
        policies: {
          hotelId: ids.full.toHexString(),
          checkInTime: '14:00',
          checkOutTime: '11:00',
          cancellationTiers: [
            { daysBeforeThreshold: 7, refundPercent: 100 },
            { daysBeforeThreshold: 2, refundPercent: 50 },
          ],
        },
        // The reviews module (HTL-23/24) is not merged yet: the stable empty shape.
        averageRating: null,
        reviewCount: 0,
        reviews: [],
        rooms: null,
      });
    });

    it('a hotel that never set its policies still answers: times null, no tiers, empty photos and amenities', async () => {
      const res = await details(ids.bare).expect(200);
      expect(res.body).toMatchObject({
        name: 'Bare Hotel',
        photos: [],
        amenities: [],
        policies: { checkInTime: null, checkOutTime: null, cancellationTiers: [] },
      });
    });

    it('does not leak internal fields (nameKey, isActive, timestamps, hotelId of rooms)', async () => {
      const res = await details(ids.full, stay).expect(200);
      for (const key of ['nameKey', 'isActive', 'createdAt', 'updatedAt', '_id', '__v']) expect(res.body).not.toHaveProperty(key);
    });
  });

  describe('rooms appear only when dates are given', () => {
    it('without dates no rooms are returned (rooms is null), and the room availability is not even asked', async () => {
      const res = await details(ids.full).expect(200);
      expect(res.body.rooms).toBeNull();
      expect(findReservedRoomIds).not.toHaveBeenCalled();
    });

    it('page and limit alone do not add rooms', async () => {
      const res = await details(ids.full, { page: 1, limit: 5 }).expect(200);
      expect(res.body.rooms).toBeNull();
    });

    it('with dates the free rooms are included, cheapest first, with the stay total, like GET /rooms/available', async () => {
      const res = await details(ids.full, stay).expect(200);
      expect(res.body.rooms).toMatchObject({ page: 1, limit: 10, total: 3, totalPages: 1 });
      expect(res.body.rooms.items.map((r: { name: string }) => r.name)).toEqual(['cheap', 'a-double', 'b-double']);
      expect(res.body.rooms.items[1]).toEqual({
        roomId: rooms['a-double'].toHexString(),
        name: 'a-double',
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        pricePerNightCents: 8_501,
        totalCents: 25_503, // 3 nights x 8 501
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        nights: 3,
        currency: 'USD',
      });
      // The rest of the page is the same as without dates.
      const without = (await details(ids.full).expect(200)).body;
      expect({ ...res.body, rooms: null }).toEqual(without);
    });

    it('is exactly the HTL-15 list: same rooms in the same order, and the shared availability rule is used once', async () => {
      const list = await http().get(`/api/hotels/${ids.full.toHexString()}/rooms/available?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}`).expect(200);
      findReservedRoomIds.mockClear();
      const res = await details(ids.full, stay).expect(200);
      expect(res.body.rooms).toEqual(list.body);
      expect(findReservedRoomIds).toHaveBeenCalledTimes(1);
    });

    it('a reserved or inactive room is not listed, and a room freed in the reservations appears again', async () => {
      const names = (body: { rooms: { items: Array<{ name: string }> } }) => body.rooms.items.map((r) => r.name);
      const first = (await details(ids.full, stay).expect(200)).body;
      expect(names(first)).not.toContain('reserved');
      expect(names(first)).not.toContain('inactive');
      reserved.delete(rooms['reserved'].toHexString());
      expect(names((await details(ids.full, stay).expect(200)).body)).toContain('reserved');
    });

    it('never lists the rooms of another hotel', async () => {
      const res = await details(ids.bare, stay).expect(200);
      expect(res.body.rooms.items.map((r: { name: string }) => r.name)).toEqual(['bare-1']);
    });

    it('no free room for the dates is an empty page, not an error and not null', async () => {
      const res = await details(ids.full, { checkIn: day(40), checkOut: day(42) }).expect(200);
      expect(res.body.rooms).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
      expect(res.body.name).toBe('Nile View Hotel'); // the rest of the page is still there
    });

    it('page and limit page the rooms', async () => {
      const first = await details(ids.full, { ...stay, page: 1, limit: 2 }).expect(200);
      expect(first.body.rooms).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
      expect(first.body.rooms.items.map((r: { name: string }) => r.name)).toEqual(['cheap', 'a-double']);
      const second = await details(ids.full, { ...stay, page: 2, limit: 2 }).expect(200);
      expect(second.body.rooms.items.map((r: { name: string }) => r.name)).toEqual(['b-double']);
    });

    it('today as check-in is allowed', async () => {
      await details(ids.full, { checkIn: day(0), checkOut: day(1) }).expect(200);
    });
  });

  describe('the hotel must exist and be active (404 in the standard shape)', () => {
    it('an inactive hotel is not shown, with or without dates', async () => {
      for (const params of [{}, stay]) {
        const res = await details(ids.off, params).expect(404);
        expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found', message: 'Hotel not found' });
        expect(res.body.path).toBe(`/api/hotels/${ids.off.toHexString()}`);
        expect(typeof res.body.timestamp).toBe('string');
      }
    });

    it('an unknown or malformed id is a 404, not a 400 or a 500', async () => {
      for (const id of [new Types.ObjectId().toHexString(), 'not-an-id', '123', 'x'.repeat(24)]) {
        const res = await details(id).expect(404);
        expect(res.body).toMatchObject({ statusCode: 404, message: 'Hotel not found' });
      }
    });

    it('an unknown hotel is a 404 even when the dates are invalid (the hotel is checked first)', async () => {
      await details(new Types.ObjectId(), { checkIn: day(5), checkOut: day(2) }).expect(404);
    });
  });

  describe('invalid dates (400 with details[{ field, message }])', () => {
    it('checkOut equal to or before checkIn', async () => {
      const same = await details(ids.full, { checkIn: day(2), checkOut: day(2) }).expect(400);
      expect(same.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
      expect(same.body.details).toEqual([{ field: 'checkOut', message: 'checkOut must be after checkIn' }]);
      expect(fields((await details(ids.full, { checkIn: day(5), checkOut: day(2) }).expect(400)).body)).toEqual(['checkOut']);
    });

    it('checkIn in the past', async () => {
      const res = await details(ids.full, { checkIn: day(-1), checkOut: day(2) }).expect(400);
      expect(res.body.details).toEqual([{ field: 'checkIn', message: 'checkIn cannot be in the past' }]);
    });

    it('only one of the two dates', async () => {
      const onlyIn = await details(ids.full, { checkIn: day(2) }).expect(400);
      expect(onlyIn.body.details).toEqual([{ field: 'checkOut', message: 'checkOut is required when the other date is sent' }]);
      const onlyOut = await details(ids.full, { checkOut: day(5) }).expect(400);
      expect(onlyOut.body.details).toEqual([{ field: 'checkIn', message: 'checkIn is required when the other date is sent' }]);
    });

    it('a malformed or impossible calendar date, one details entry per bad field', async () => {
      expect(fields((await details(ids.full, { checkIn: '2099-02-30', checkOut: '2099-03-02' }).expect(400)).body)).toEqual(['checkIn']);
      expect(fields((await details(ids.full, { checkIn: 'tomorrow', checkOut: '10/03/2099' }).expect(400)).body).sort()).toEqual(['checkIn', 'checkOut']);
      expect(fields((await details(ids.full, { checkIn: day(2), checkOut: '' }).expect(400)).body)).toEqual(['checkOut']);
    });

    it('bad paging and unknown query fields', async () => {
      expect(fields((await details(ids.full, { ...stay, limit: 51 }).expect(400)).body)).toEqual(['limit']);
      expect(fields((await details(ids.full, { ...stay, page: 0 }).expect(400)).body)).toEqual(['page']);
      expect(fields((await details(ids.full, { guests: 2 }).expect(400)).body)).toEqual(['guests']);
    });
  });

  describe('routing', () => {
    it('GET /hotels/search is still the search, not a hotel with the id "search"', async () => {
      const res = await http().get('/api/hotels/search').expect(400); // search validation, not a 404 from :id
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it('GET /hotels/:id/rooms/available is still the HTL-15 list', async () => {
      const res = await http().get(`/api/hotels/${ids.full.toHexString()}/rooms/available?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}`).expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  describe('Swagger', () => {
    it('documents the endpoint as public with its 400 and 404', async () => {
      const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
      const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('t').build());
      const op = doc.paths['/api/hotels/{id}']?.get;
      expect(op).toBeDefined();
      expect(op?.summary).toContain('HTL-02');
      expect(Object.keys(op?.responses ?? {})).toEqual(expect.arrayContaining(['200', '400', '404']));
    });
  });
});
