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
import { buildSwaggerDocument, setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

/** Dates relative to today (UTC), so the "not in the past" rule never makes the test data stale. */
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('HTL-11 hotel search (e2e, real MongoDB)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;

  // Test double for Hessain's reservations (HTL-16/18): ids in this set count as reserved or held.
  const reserved = new Set<string>();
  const findReservedRoomIds = jest.fn(async (ids: string[]) => new Set(ids.filter((id) => reserved.has(id))));

  const http = () => request(app.getHttpServer());
  const search = (params: Record<string, string | number>) => {
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return http().get(`/api/hotels/search?${qs}`);
  };
  /** Cairo, stay of 3 nights d2, d3, d4 (check-out d5). */
  const stay = { checkIn: day(2), checkOut: day(5) };

  const ids = {
    alpha: new Types.ObjectId(),
    beta: new Types.ObjectId(),
    gamma: new Types.ObjectId(),
    delta: new Types.ObjectId(),
    epsilon: new Types.ObjectId(),
  };
  const rooms: Record<string, Types.ObjectId> = {};

  const hotel = (
    _id: Types.ObjectId,
    name: string,
    cityId: string,
    countryCode: string,
    isActive = true,
    averageRating: number | null = null,
  ) => ({
    _id,
    name,
    nameKey: name.toLowerCase(),
    address: '1 Test Street',
    cityId,
    countryCode,
    description: 'Hotel.',
    photos: [],
    starRating: 4,
    amenities: [],
    cancellationTiers: [],
    isActive,
    averageRating,
    reviewCount: averageRating === null ? 0 : 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const room = (
    key: string,
    hotelId: Types.ObjectId,
    maxOccupancy: number,
    pricePerNightCents: number,
    ranges: Array<[number, number]>,
    isActive = true,
  ) => {
    rooms[key] = new Types.ObjectId();
    return {
      _id: rooms[key],
      hotelId,
      name: key,
      nameKey: key,
      type: 'Double',
      beds: 1,
      maxOccupancy,
      pricePerNightCents,
      isActive,
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

    await db.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
    ]);
    await db.collection('cities').insertMany([
      { city_id: 'CAI', name: 'Cairo', country_code: 'EG' },
      { city_id: 'ALY', name: 'Alexandria', country_code: 'EG' },
      { city_id: 'LON', name: 'London', country_code: 'GB' },
    ]);
    await db
      .collection('hotels')
      .insertMany([
        hotel(ids.alpha, 'Alpha', 'CAI', 'EG', true, 4.5),
        hotel(ids.beta, 'Beta', 'CAI', 'EG', true, 3.2),
        hotel(ids.gamma, 'Gamma', 'CAI', 'EG', false), // deactivated by an admin
        hotel(ids.delta, 'Delta', 'ALY', 'EG'), // deliberately unrated (HTL-12)
        hotel(ids.epsilon, 'Epsilon', 'LON', 'GB', true, 4),
      ]);
    await db.collection('rooms').insertMany([
      // Alpha: two free rooms (2 guests each) + one big room that is free only for part of the stay
      room('alpha-1', ids.alpha, 2, 10_000, [[1, 10]]),
      room('alpha-2', ids.alpha, 2, 12_000, [[1, 10]]),
      room('alpha-big', ids.alpha, 4, 30_000, [[1, 4]]), // night d4 missing: stay is d2..d4
      // Beta: cheapest room is made of two ADJACENT ranges; the others must not count
      room('beta-1', ids.beta, 2, 8_000, [[1, 5], [5, 10]]),
      room('beta-inactive', ids.beta, 2, 1_000, [[1, 10]], false),
      room('beta-gap', ids.beta, 2, 1_000, [[1, 4], [5, 10]]), // one-night gap (night d4)
      // Gamma: inactive hotel with a perfect room
      room('gamma-1', ids.gamma, 2, 5_000, [[1, 10]]),
      // Delta (Alexandria): its only room is reserved
      room('delta-1', ids.delta, 2, 7_000, [[1, 10]]),
      // Epsilon (London)
      room('epsilon-1', ids.epsilon, 3, 20_000, [[1, 10]]),
    ]);
  }, 120_000);

  beforeEach(() => {
    reserved.clear();
    reserved.add(rooms['delta-1'].toHexString());
    findReservedRoomIds.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('search by city', () => {
    it('a guest (no login) gets 200; rooms defaults to 1; cheapest first; inactive hotel excluded', async () => {
      const res = await search({ cityId: 'CAI', ...stay, guests: 2 }).expect(200);
      expect(res.body.items.map((h: { name: string }) => h.name)).toEqual(['Beta', 'Alpha']);
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 2, totalPages: 1 });
      expect(res.body.items[0]).toEqual({
        id: ids.beta.toHexString(),
        name: 'Beta',
        cityId: 'CAI',
        cityName: 'Cairo',
        countryCode: 'EG',
        countryName: 'Egypt',
        starRating: 4,
        freeRooms: 1, // beta-1 only: inactive room and the room with a gap do not count
        nights: 3,
        cheapestTotalCents: 24_000, // 3 nights x 8 000
        currency: 'USD',
      });
      // Alpha: the two full rooms are free; alpha-big is not free for the whole stay
      expect(res.body.items[1]).toMatchObject({ name: 'Alpha', freeRooms: 2, cheapestTotalCents: 30_000 });
    });

    it('answers the same without an explicit rooms and with rooms=1', async () => {
      const a = await search({ cityId: 'CAI', ...stay, guests: 2 }).expect(200);
      const b = await search({ cityId: 'CAI', ...stay, guests: 2, rooms: 1 }).expect(200);
      expect(b.body).toEqual(a.body);
    });

    it('a room free for only part of the stay is not counted (3 guests need the big room, which misses night d4)', async () => {
      const res = await search({ cityId: 'CAI', ...stay, guests: 3 }).expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('the same room counts for a shorter stay it fully covers', async () => {
      const res = await search({ cityId: 'CAI', checkIn: day(1), checkOut: day(3), guests: 3 }).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ name: 'Alpha', freeRooms: 3, nights: 2, cheapestTotalCents: 60_000 });
    });

    it('a stay of ranges that are adjacent is covered (Beta)', async () => {
      const res = await search({ cityId: 'CAI', checkIn: day(3), checkOut: day(8), guests: 2 }).expect(200);
      const beta = res.body.items.find((h: { name: string }) => h.name === 'Beta');
      expect(beta).toMatchObject({ freeRooms: 1, nights: 5, cheapestTotalCents: 40_000 }); // only beta-1 (adjacent ranges); beta-gap misses night d4
    });

    it('rooms=2: needs two free rooms whose combined occupancy covers the guests', async () => {
      const ok = await search({ cityId: 'CAI', ...stay, guests: 4, rooms: 2 }).expect(200);
      expect(ok.body.items.map((h: { name: string }) => h.name)).toEqual(['Alpha']); // Beta has only 1 free room
      expect(ok.body.items[0].cheapestTotalCents).toBe(66_000); // (10 000 + 12 000) x 3

      const tooMany = await search({ cityId: 'CAI', ...stay, guests: 5, rooms: 2 }).expect(200);
      expect(tooMany.body.items).toEqual([]); // 2 + 2 = 4 < 5
    });

    it('a hotel with enough rooms but too little combined occupancy is excluded', async () => {
      const res = await search({ cityId: 'LON', ...stay, guests: 4 }).expect(200);
      expect(res.body.items).toEqual([]); // Epsilon sleeps 3
      const fits = await search({ cityId: 'LON', ...stay, guests: 3 }).expect(200);
      expect(fits.body.items.map((h: { name: string }) => h.name)).toEqual(['Epsilon']);
    });

    it('a room that is reserved or held is not counted (RoomReservations double)', async () => {
      expect((await search({ cityId: 'ALY', ...stay, guests: 2 }).expect(200)).body.items).toEqual([]);

      reserved.delete(rooms['delta-1'].toHexString());
      expect((await search({ cityId: 'ALY', ...stay, guests: 2 }).expect(200)).body.items).toHaveLength(1);

      reserved.add(rooms['beta-1'].toHexString());
      const cairo = await search({ cityId: 'CAI', ...stay, guests: 2 }).expect(200);
      expect(cairo.body.items.map((h: { name: string }) => h.name)).toEqual(['Alpha']); // Beta's only free room is taken
    });

    it('asks RoomReservations once per search for all rooms (no query per room)', async () => {
      await search({ cityId: 'CAI', ...stay, guests: 2 }).expect(200);
      expect(findReservedRoomIds).toHaveBeenCalledTimes(1);
      expect(findReservedRoomIds.mock.calls[0][0].length).toBeGreaterThan(1);
    });

    it('no match is an empty paginated list, not an error', async () => {
      const res = await search({ cityId: 'CAI', checkIn: day(40), checkOut: day(42), guests: 1 }).expect(200);
      expect(res.body).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
    });
  });

  describe('search by country', () => {
    it('lists the matching hotels of every city of the country with their city names', async () => {
      reserved.clear();
      const res = await search({ countryCode: 'eg', ...stay, guests: 2 }).expect(200); // lower case is accepted
      expect(res.body.items.map((h: { name: string; cityName: string }) => `${h.name}/${h.cityName}`)).toEqual([
        'Delta/Alexandria', // 7 000 x 3
        'Beta/Cairo', // 8 000 x 3
        'Alpha/Cairo', // 10 000 x 3
      ]);
    });

    it('does not return hotels of other countries', async () => {
      const res = await search({ countryCode: 'GB', ...stay, guests: 1 }).expect(200);
      expect(res.body.items.map((h: { name: string }) => h.name)).toEqual(['Epsilon']);
    });
  });

  describe('price and rating filters (HTL-12)', () => {
    const names = (body: { items: Array<{ name: string }> }) => body.items.map((h) => h.name);

    it('applies the price bounds inclusively to the cheapest qualifying room', async () => {
      // Beta's cheapest room is 8 000/night, Alpha's 10 000/night (guests=2, rooms=1).
      const wholeRange = await search({ cityId: 'CAI', ...stay, guests: 2, minPrice: 8_000, maxPrice: 10_000 }).expect(200);
      expect(names(wholeRange.body)).toEqual(['Beta', 'Alpha']);

      expect(names((await search({ cityId: 'CAI', ...stay, guests: 2, minPrice: 8_000 }).expect(200)).body)).toEqual([
        'Beta',
        'Alpha',
      ]);
      expect(names((await search({ cityId: 'CAI', ...stay, guests: 2, maxPrice: 8_000 }).expect(200)).body)).toEqual([
        'Beta',
      ]);
      expect(names((await search({ cityId: 'CAI', ...stay, guests: 2, minPrice: 10_000 }).expect(200)).body)).toEqual([
        'Alpha',
      ]);
      expect(
        (await search({ cityId: 'CAI', ...stay, guests: 2, minPrice: 8_001, maxPrice: 9_999 }).expect(200)).body.items,
      ).toEqual([]);
    });

    it('uses the cheapest combination for the requested rooms, not the cheapest single room', async () => {
      // rooms=2 + guests=4: Alpha's qualifying nightly price is 10 000 + 12 000 = 22 000 (Beta has only one free room).
      const inRange = await search({
        cityId: 'CAI',
        ...stay,
        guests: 4,
        rooms: 2,
        minPrice: 22_000,
        maxPrice: 22_000,
      }).expect(200);
      expect(names(inRange.body)).toEqual(['Alpha']);

      // Alpha's cheapest single room is 10 000, so a filter that used it would still include the hotel here.
      const tooLow = await search({ cityId: 'CAI', ...stay, guests: 4, rooms: 2, maxPrice: 21_999 }).expect(200);
      expect(tooLow.body.items).toEqual([]);
    });

    it('keeps only hotels at or above minRating, decimals included', async () => {
      // Alpha 4.5, Beta 3.2.
      expect(names((await search({ cityId: 'CAI', ...stay, guests: 2, minRating: 4 }).expect(200)).body)).toEqual([
        'Alpha',
      ]);
      expect(names((await search({ cityId: 'CAI', ...stay, guests: 2, minRating: 4.5 }).expect(200)).body)).toEqual([
        'Alpha',
      ]);
      expect(names((await search({ cityId: 'CAI', ...stay, guests: 2, minRating: 3 }).expect(200)).body)).toEqual([
        'Beta',
        'Alpha',
      ]);
    });

    it('excludes a hotel with no rating as soon as minRating is set', async () => {
      reserved.clear(); // Delta's only room is free for this test
      expect(names((await search({ cityId: 'ALY', ...stay, guests: 2 }).expect(200)).body)).toEqual(['Delta']);
      expect(names((await search({ cityId: 'ALY', ...stay, guests: 2, minRating: 1 }).expect(200)).body)).toEqual([]);
    });

    it('combines the price and rating filters with the requested sort', async () => {
      reserved.clear(); // Delta (7 000, unrated) must be dropped by minRating even though it is inside the price range
      const res = await search({
        countryCode: 'EG',
        ...stay,
        guests: 2,
        maxPrice: 10_000,
        minRating: 1,
        sort: 'rating',
        order: 'desc',
      }).expect(200);
      expect(names(res.body)).toEqual(['Alpha', 'Beta']); // 4.5 then 3.2
      expect(res.body).toMatchObject({ total: 2, totalPages: 1 });
    });
  });

  describe('sorting (HTL-12)', () => {
    const names = (body: { items: Array<{ name: string }> }) => body.items.map((h) => h.name);

    it('sorts by price per night in both directions', async () => {
      const asc = await search({ cityId: 'CAI', ...stay, guests: 2, sort: 'price', order: 'asc' }).expect(200);
      expect(names(asc.body)).toEqual(['Beta', 'Alpha']);
      const desc = await search({ cityId: 'CAI', ...stay, guests: 2, sort: 'price', order: 'desc' }).expect(200);
      expect(names(desc.body)).toEqual(['Alpha', 'Beta']);
    });

    it('sorts by rating in both directions and always puts unrated hotels last', async () => {
      reserved.clear(); // Delta (unrated) is part of the country results
      const desc = await search({ countryCode: 'EG', ...stay, guests: 2, sort: 'rating', order: 'desc' }).expect(200);
      expect(names(desc.body)).toEqual(['Alpha', 'Beta', 'Delta']); // 4.5, 3.2, no rating
      const asc = await search({ countryCode: 'EG', ...stay, guests: 2, sort: 'rating', order: 'asc' }).expect(200);
      expect(names(asc.body)).toEqual(['Beta', 'Alpha', 'Delta']); // 3.2, 4.5, no rating last
    });

    it('defaults to the old HTL-11 cheapest-first order', async () => {
      const plain = await search({ cityId: 'CAI', ...stay, guests: 2 }).expect(200);
      const explicit = await search({ cityId: 'CAI', ...stay, guests: 2, sort: 'price', order: 'asc' }).expect(200);
      expect(explicit.body).toEqual(plain.body);
    });

    it('paginates the sorted matches', async () => {
      const first = await search({
        cityId: 'CAI',
        ...stay,
        guests: 2,
        sort: 'price',
        order: 'desc',
        page: 1,
        limit: 1,
      }).expect(200);
      expect(names(first.body)).toEqual(['Alpha']);
      const second = await search({
        cityId: 'CAI',
        ...stay,
        guests: 2,
        sort: 'price',
        order: 'desc',
        page: 2,
        limit: 1,
      }).expect(200);
      expect(names(second.body)).toEqual(['Beta']);
    });
  });

  describe('pagination', () => {
    it('pages the matches with page and limit', async () => {
      const first = await search({ cityId: 'CAI', ...stay, guests: 2, page: 1, limit: 1 }).expect(200);
      expect(first.body).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
      expect(first.body.items.map((h: { name: string }) => h.name)).toEqual(['Beta']);
      const second = await search({ cityId: 'CAI', ...stay, guests: 2, page: 2, limit: 1 }).expect(200);
      expect(second.body.items.map((h: { name: string }) => h.name)).toEqual(['Alpha']);
      const past = await search({ cityId: 'CAI', ...stay, guests: 2, page: 3, limit: 1 }).expect(200);
      expect(past.body.items).toEqual([]);
    });

    it('rejects limit above 50', async () => {
      const res = await search({ cityId: 'CAI', ...stay, guests: 2, limit: 51 }).expect(400);
      expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'limit' })]));
    });
  });

  describe('validation (400 with details[{ field, message }])', () => {
    const fields = (body: { details: Array<{ field: string }> }) => body.details.map((d) => d.field);

    it('check-out equal to check-in', async () => {
      const res = await search({ cityId: 'CAI', checkIn: day(2), checkOut: day(2), guests: 2 }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
      expect(res.body.details).toEqual([{ field: 'checkOut', message: 'checkOut must be after checkIn' }]);
    });

    it('check-out before check-in', async () => {
      const res = await search({ cityId: 'CAI', checkIn: day(5), checkOut: day(2), guests: 2 }).expect(400);
      expect(fields(res.body)).toEqual(['checkOut']);
    });

    it('check-in in the past', async () => {
      const res = await search({ cityId: 'CAI', checkIn: day(-1), checkOut: day(2), guests: 2 }).expect(400);
      expect(res.body.details).toEqual([{ field: 'checkIn', message: 'checkIn cannot be in the past' }]);
    });

    it('check-in today is allowed', async () => {
      await search({ cityId: 'CAI', checkIn: day(0), checkOut: day(1), guests: 2 }).expect(200);
    });

    it('reports every broken rule at once', async () => {
      const res = await search({ cityId: 'CAI', checkIn: day(-1), checkOut: day(-3), guests: 2 }).expect(400);
      expect(fields(res.body).sort()).toEqual(['checkIn', 'checkOut']);
    });

    it('missing dates and guests: one entry per field', async () => {
      const res = await search({ cityId: 'CAI' }).expect(400);
      expect(fields(res.body)).toEqual(expect.arrayContaining(['checkIn', 'checkOut', 'guests']));
    });

    it('an impossible calendar date', async () => {
      const res = await search({ cityId: 'CAI', checkIn: '2099-02-30', checkOut: '2099-03-02', guests: 2 }).expect(400);
      expect(fields(res.body)).toEqual(['checkIn']);
    });

    it('neither cityId nor countryCode', async () => {
      const res = await search({ ...stay, guests: 2 }).expect(400);
      expect(res.body.details).toEqual([{ field: 'cityId', message: 'Provide cityId or countryCode' }]);
    });

    it('both cityId and countryCode', async () => {
      const res = await search({ cityId: 'CAI', countryCode: 'EG', ...stay, guests: 2 }).expect(400);
      expect(fields(res.body)).toEqual(['countryCode']);
    });

    it('an unknown city and an unknown country', async () => {
      expect(fields((await search({ cityId: 'NOPE', ...stay, guests: 2 }).expect(400)).body)).toEqual(['cityId']);
      expect(fields((await search({ countryCode: 'ZZ', ...stay, guests: 2 }).expect(400)).body)).toEqual(['countryCode']);
    });

    it('guests and rooms below 1, not whole, or above the limit', async () => {
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 0 }).expect(400)).body)).toEqual(['guests']);
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, rooms: 0 }).expect(400)).body)).toEqual(['rooms']);
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 1.5 }).expect(400)).body)).toEqual(['guests']);
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 101 }).expect(400)).body)).toEqual(['guests']);
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, rooms: 11 }).expect(400)).body)).toEqual(['rooms']);
    });

    it('minPrice above maxPrice', async () => {
      const res = await search({ cityId: 'CAI', ...stay, guests: 2, minPrice: 10_001, maxPrice: 10_000 }).expect(400);
      expect(res.body.details).toEqual([{ field: 'minPrice', message: 'minPrice must not be greater than maxPrice' }]);
    });

    it('price bounds must be whole, non-negative cents', async () => {
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, minPrice: -1 }).expect(400)).body)).toEqual([
        'minPrice',
      ]);
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, maxPrice: 1.5 }).expect(400)).body)).toEqual([
        'maxPrice',
      ]);
      // "abc" breaks two constraints (whole number and >= 0), so only the field is asserted here.
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, minPrice: 'abc' }).expect(400)).body)).toContain(
        'minPrice',
      );
    });

    it('minRating must be a number between 1 and 5', async () => {
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, minRating: 0 }).expect(400)).body)).toEqual([
        'minRating',
      ]);
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, minRating: 5.1 }).expect(400)).body)).toEqual([
        'minRating',
      ]);
      // "abc" breaks the number, minimum and maximum rules, so only the field is asserted here.
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, minRating: 'abc' }).expect(400)).body)).toContain(
        'minRating',
      );
    });

    it('an unknown sort or order value', async () => {
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, sort: 'stars' }).expect(400)).body)).toEqual([
        'sort',
      ]);
      expect(fields((await search({ cityId: 'CAI', ...stay, guests: 2, order: 'up' }).expect(400)).body)).toEqual([
        'order',
      ]);
    });

    it('an unknown query parameter', async () => {
      const res = await search({ cityId: 'CAI', ...stay, guests: 2, currency: 'USD' }).expect(400);
      expect(fields(res.body)).toEqual(['currency']);
    });
  });

  describe('routing', () => {
    it('search is not captured by an :id route (404 only for unknown paths, 200 for search)', async () => {
      await search({ cityId: 'CAI', ...stay, guests: 2 }).expect(200);
    });
  });

  describe('swagger', () => {
    it('documents the HTL-12 filters and sorting', () => {
      const operation = buildSwaggerDocument(app).paths['/api/hotels/search']?.get;
      expect(operation).toBeDefined();
      const parameters = (operation?.parameters ?? []).map((parameter) => ('name' in parameter ? parameter.name : ''));
      expect(parameters).toEqual(
        expect.arrayContaining(['minPrice', 'maxPrice', 'minRating', 'sort', 'order']),
      );
    });
  });
});
