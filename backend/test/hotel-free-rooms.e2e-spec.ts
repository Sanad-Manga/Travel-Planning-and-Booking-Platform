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

describe('HTL-15 free rooms of a hotel (e2e, real MongoDB)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;

  // Test double for Hessain's reservations (HTL-16/18): ids in this set count as reserved or held.
  const reserved = new Set<string>();
  const findReservedRoomIds = jest.fn(async (ids: string[]) => new Set(ids.filter((id) => reserved.has(id))));

  const http = () => request(app.getHttpServer());
  const free = (hotelId: Types.ObjectId | string, params: Record<string, string | number>) => {
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return http().get(`/api/hotels/${String(hotelId)}/rooms/available?${qs}`);
  };
  /** Stay of 3 nights d2, d3, d4 (check-out d5). */
  const stay = { checkIn: day(2), checkOut: day(5) };

  const ids = { alpha: new Types.ObjectId(), beta: new Types.ObjectId(), off: new Types.ObjectId() };
  const rooms: Record<string, Types.ObjectId> = {};
  const names = (body: { items: Array<{ name: string }> }) => body.items.map((r) => r.name);

  const hotel = (_id: Types.ObjectId, name: string, isActive = true) => ({
    _id,
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
    isActive,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const room = (
    key: string,
    hotelId: Types.ObjectId,
    pricePerNightCents: number,
    ranges: Array<[number, number]>,
    extra: { isActive?: boolean; type?: string; beds?: number; maxOccupancy?: number } = {},
  ) => {
    rooms[key] = new Types.ObjectId();
    return {
      _id: rooms[key],
      hotelId,
      name: key,
      nameKey: key,
      type: extra.type ?? 'Double',
      beds: extra.beds ?? 1,
      maxOccupancy: extra.maxOccupancy ?? 2,
      pricePerNightCents,
      isActive: extra.isActive ?? true,
      availability: ranges.map(([from, to]) => ({ _id: new Types.ObjectId(), startDate: day(from), endDate: day(to) })),
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

    await db.collection('hotels').insertMany([hotel(ids.alpha, 'Alpha'), hotel(ids.beta, 'Beta'), hotel(ids.off, 'Off', false)]);
    await db.collection('rooms').insertMany([
      // Alpha
      room('c-suite', ids.alpha, 20_001, [[1, 10]], { type: 'Suite', beds: 3, maxOccupancy: 6 }),
      room('a-double', ids.alpha, 8_501, [[1, 10]], { type: 'Double', beds: 2, maxOccupancy: 3 }),
      room('b-double', ids.alpha, 8_501, [[1, 10]]), // same price as a-double: name decides
      room('adjacent', ids.alpha, 9_999, [[1, 5], [5, 10]]), // two adjacent ranges cover the stay
      room('partial', ids.alpha, 5_000, [[1, 4]]), // night d4 missing
      room('gap', ids.alpha, 5_000, [[1, 4], [5, 10]]), // one-night gap (night d4)
      room('inactive', ids.alpha, 5_000, [[1, 10]], { isActive: false }),
      room('reserved', ids.alpha, 6_000, [[1, 10]]),
      room('exact', ids.alpha, 7_000, [[2, 5]]), // covers exactly the stay
      // Beta: another hotel, must never appear in Alpha's list
      room('beta-1', ids.beta, 1_000, [[1, 10]]),
      // Off: deactivated hotel
      room('off-1', ids.off, 1_000, [[1, 10]]),
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

  describe('which rooms are listed', () => {
    it('a guest (no login) gets only rooms free for every night, cheapest first (then name, then id)', async () => {
      const res = await free(ids.alpha, stay).expect(200);
      // exact 7 000, a-double 8 501, b-double 8 501, adjacent 9 999, c-suite 20 001
      expect(names(res.body)).toEqual(['exact', 'a-double', 'b-double', 'adjacent', 'c-suite']);
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 5, totalPages: 1 });
    });

    it('a room free for only part of the stay, one with a gap, an inactive room and a reserved room are not returned', async () => {
      const list = names((await free(ids.alpha, stay).expect(200)).body);
      for (const excluded of ['partial', 'gap', 'inactive', 'reserved']) expect(list).not.toContain(excluded);
    });

    it('adjacent ranges that together cover the stay are returned', async () => {
      const res = await free(ids.alpha, { checkIn: day(3), checkOut: day(8) }).expect(200);
      expect(names(res.body)).toContain('adjacent');
      expect(names(res.body)).not.toContain('exact'); // its range ends on d5
    });

    it('a shorter stay that a partial room fully covers returns that room', async () => {
      const res = await free(ids.alpha, { checkIn: day(1), checkOut: day(3) }).expect(200);
      expect(names(res.body)).toEqual(expect.arrayContaining(['partial', 'gap']));
    });

    it('never returns the rooms of another hotel', async () => {
      const res = await free(ids.alpha, stay).expect(200);
      expect(names(res.body)).not.toContain('beta-1');
      expect(names((await free(ids.beta, stay).expect(200)).body)).toEqual(['beta-1']);
    });

    it('uses the shared availability function: a room that RoomReservations reports reserved disappears, and it is asked once', async () => {
      reserved.add(rooms['a-double'].toHexString());
      const res = await free(ids.alpha, stay).expect(200);
      expect(names(res.body)).toEqual(['exact', 'b-double', 'adjacent', 'c-suite']);
      expect(findReservedRoomIds).toHaveBeenCalledTimes(1);
      expect(findReservedRoomIds).toHaveBeenCalledWith(expect.arrayContaining([rooms['a-double'].toHexString()]), stay.checkIn, stay.checkOut);

      reserved.delete(rooms['reserved'].toHexString());
      expect(names((await free(ids.alpha, stay).expect(200)).body)).toContain('reserved');
    });

    it('no free room is an empty paginated list, not an error', async () => {
      const res = await free(ids.alpha, { checkIn: day(40), checkOut: day(42) }).expect(200);
      expect(res.body).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
    });
  });

  describe('what each room shows', () => {
    it('type, beds, max occupancy, price per night and the stay total (nights x price, integer cents)', async () => {
      const res = await free(ids.alpha, stay).expect(200);
      const aDouble = res.body.items.find((r: { name: string }) => r.name === 'a-double');
      expect(aDouble).toEqual({
        roomId: rooms['a-double'].toHexString(),
        name: 'a-double',
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        pricePerNightCents: 8_501,
        totalCents: 25_503, // 3 x 8 501
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        nights: 3,
        currency: 'USD',
      });
      const suite = res.body.items.find((r: { name: string }) => r.name === 'c-suite');
      expect(suite).toMatchObject({ type: 'Suite', beds: 3, maxOccupancy: 6, totalCents: 60_003 });
      for (const item of res.body.items) {
        expect(Number.isInteger(item.totalCents)).toBe(true);
        expect(item.totalCents).toBe(item.nights * item.pricePerNightCents);
      }
    });

    it('a one-night stay and a long stay', async () => {
      const one = await free(ids.alpha, { checkIn: day(2), checkOut: day(3) }).expect(200);
      const exact = one.body.items.find((r: { name: string }) => r.name === 'exact');
      expect(exact).toMatchObject({ nights: 1, totalCents: 7_000 });
      expect(one.body.items[0]).toMatchObject({ name: 'gap', totalCents: 5_000 }); // d2 alone is covered by the gap room
      const long = await free(ids.alpha, { checkIn: day(1), checkOut: day(9) }).expect(200);
      const adjacent = long.body.items.find((r: { name: string }) => r.name === 'adjacent');
      expect(adjacent).toMatchObject({ nights: 8, totalCents: 79_992 });
    });

    it('each roomId is the room _id the booking will receive', async () => {
      const res = await free(ids.beta, stay).expect(200);
      expect(res.body.items[0].roomId).toBe(rooms['beta-1'].toHexString());
    });
  });

  describe('pagination', () => {
    it('pages the list with page and limit, in the same order; a page past the end is empty', async () => {
      const first = await free(ids.alpha, { ...stay, page: 1, limit: 2 }).expect(200);
      expect(first.body).toMatchObject({ page: 1, limit: 2, total: 5, totalPages: 3 });
      expect(names(first.body)).toEqual(['exact', 'a-double']);
      const last = await free(ids.alpha, { ...stay, page: 3, limit: 2 }).expect(200);
      expect(names(last.body)).toEqual(['c-suite']);
      const past = await free(ids.alpha, { ...stay, page: 4, limit: 2 }).expect(200);
      expect(past.body).toMatchObject({ items: [], page: 4, total: 5, totalPages: 3 });
    });

    it('rejects limit above 50', async () => {
      const res = await free(ids.alpha, { ...stay, limit: 51 }).expect(400);
      expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'limit' })]));
    });
  });

  describe('validation (400 with details[{ field, message }])', () => {
    const fields = (body: { details: Array<{ field: string }> }) => body.details.map((d) => d.field);

    it('checkOut equal to or before checkIn', async () => {
      const same = await free(ids.alpha, { checkIn: day(2), checkOut: day(2) }).expect(400);
      expect(same.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
      expect(same.body.details).toEqual([{ field: 'checkOut', message: 'checkOut must be after checkIn' }]);
      expect(fields((await free(ids.alpha, { checkIn: day(5), checkOut: day(2) }).expect(400)).body)).toEqual(['checkOut']);
    });

    it('checkIn in the past; today is allowed', async () => {
      const res = await free(ids.alpha, { checkIn: day(-1), checkOut: day(2) }).expect(400);
      expect(res.body.details).toEqual([{ field: 'checkIn', message: 'checkIn cannot be in the past' }]);
      await free(ids.alpha, { checkIn: day(0), checkOut: day(1) }).expect(200);
    });

    it('a missing date and an impossible calendar date', async () => {
      expect(fields((await free(ids.alpha, { checkIn: day(2) }).expect(400)).body)).toEqual(['checkOut']);
      expect(fields((await free(ids.alpha, {}).expect(400)).body).sort()).toEqual(['checkIn', 'checkOut']);
      expect(fields((await free(ids.alpha, { checkIn: '2099-02-30', checkOut: '2099-03-02' }).expect(400)).body)).toEqual(['checkIn']);
    });

    it('an unknown query field is a 400 (no guests or rooms params in this ticket)', async () => {
      const res = await free(ids.alpha, { ...stay, guests: 2 }).expect(400);
      expect(fields(res.body)).toEqual(['guests']);
    });
  });

  describe('the hotel', () => {
    it('an unknown, malformed or deactivated hotel is a 404 in the standard shape', async () => {
      for (const id of [new Types.ObjectId().toHexString(), 'not-an-id', ids.off.toHexString()]) {
        const res = await free(id, stay).expect(404);
        expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found', message: 'Hotel not found' });
        expect(res.body.path).toContain('/rooms/available');
      }
    });

    it('the path is not captured by another :id route', async () => {
      // GET /hotels/search is a fixed route; rooms/available must not be read as a hotel id either.
      const res = await free(ids.alpha, stay).expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });
});
