import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { Role } from '../src/common';
import configuration from '../src/config/configuration';
import { HotelsModule } from '../src/hotels/hotels.module';
import { setupApp, setupSwagger } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

/** Dates relative to today (UTC), so the tests never go stale. */
const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const PASSWORD = 'Passw0rdOK';

interface Day {
  date: string;
  status: string;
  reservation?: { id: string; reference: string | null; status: string; checkIn: string; checkOut: string };
  blockedReason?: string;
}
interface RoomItem {
  roomId: string;
  name: string;
  isActive: boolean;
  days: Day[];
}

describe('HTL-08 room status per date range (e2e, real MongoDB)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;

  const http = () => request(app.getHttpServer());
  const ids = { alpha: new Types.ObjectId(), beta: new Types.ObjectId(), ghost: new Types.ObjectId() };
  const rooms: Record<string, Types.ObjectId> = {};
  const cookies: Record<string, string> = {};

  /** Range d0 .. d11 (12 dates) unless a test asks for another one. */
  const range = { from: day(0), to: day(11) };
  const status = (hotelId: Types.ObjectId | string, cookie: string | undefined, params: Record<string, string | number> = range) => {
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    const req = http().get(`/api/hotels/${String(hotelId)}/availability?${qs}`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const item = (body: { items: RoomItem[] }, name: string): RoomItem => {
    const found = body.items.find((room) => room.name === name);
    if (!found) throw new Error(`room ${name} not in the response`);
    return found;
  };
  const statuses = (room: RoomItem): string[] => room.days.map((d) => d.status);

  const hotel = (_id: Types.ObjectId, name: string) => ({
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
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const room = (
    key: string,
    hotelId: Types.ObjectId,
    ranges: Array<[number, number]>,
    extra: { isActive?: boolean; blocked?: Array<[number, number]> } = {},
  ) => {
    rooms[key] = new Types.ObjectId();
    const toRanges = (list: Array<[number, number]>) =>
      list.map(([from, to]) => ({ _id: new Types.ObjectId(), startDate: day(from), endDate: day(to) }));
    return {
      _id: rooms[key],
      hotelId,
      name: key,
      nameKey: key.toLowerCase(),
      type: 'Double',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightCents: 8_500,
      isActive: extra.isActive ?? true,
      availability: toRanges(ranges),
      // HTL-06 stores blocked ranges on the room as `blockedRanges`; the schema is not on develop yet, so insert raw.
      ...(extra.blocked ? { blockedRanges: toRanges(extra.blocked) } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  const booking = (
    hotelId: Types.ObjectId,
    roomKey: string,
    checkIn: number,
    checkOut: number,
    extra: { status?: string; reference?: string; holdExpiresAt?: Date } = {},
  ) => ({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    hotelId,
    checkIn: day(checkIn),
    checkOut: day(checkOut),
    nights: checkOut - checkIn,
    rooms: [{ roomId: rooms[roomKey], adults: 1, children: 0, name: roomKey, type: 'Double', maxOccupancy: 2, pricePerNightCents: 8_500, totalCents: 8_500 * (checkOut - checkIn) }],
    totalCents: 8_500 * (checkOut - checkIn),
    currency: 'USD',
    status: extra.status ?? 'CONFIRMED',
    ...(extra.reference ? { bookingReference: extra.reference } : {}),
    ...(extra.holdExpiresAt ? { holdExpiresAt: extra.holdExpiresAt } : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const insertUser = (email: string, extra: Record<string, unknown>) =>
    db.collection('users').insertOne({
      name: 'Seeded',
      email,
      passwordHash: hashSync(PASSWORD, 4),
      status: 'ACTIVE',
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
  const loginCookie = async (email: string): Promise<string> => {
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return ((res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('access_token=')) as string).split(';')[0];
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
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());

    await db.collection('hotels').insertMany([hotel(ids.alpha, 'Alpha'), hotel(ids.beta, 'Beta')]);
    const alphaRooms = [
      // Offered for d0..d29: Booked / Available cases.
      room('1-booked', ids.alpha, [[0, 30]]),
      // Offered for d0..d29, blocked d3..d4 (block range [d3, d5)).
      room('2-blocked', ids.alpha, [[0, 30]], { blocked: [[3, 5]] }),
      // Taken out of sale.
      room('3-inactive', ids.alpha, [[0, 30]], { isActive: false }),
      // Offered only d4..d7.
      room('4-partial', ids.alpha, [[4, 8]]),
      // A block over a night that is already booked: the booking wins.
      room('5-both', ids.alpha, [[0, 30]], { blocked: [[0, 12]] }),
      // Natural ordering: "10" comes after "9".
      room('9', ids.alpha, [[0, 30]]),
      room('10', ids.alpha, [[0, 30]]),
    ];
    await db.collection('rooms').insertMany([...alphaRooms, room('beta-1', ids.beta, [[0, 30]])]);

    const future = new Date(Date.now() + 10 * 60_000);
    const past = new Date(Date.now() - 10 * 60_000);
    await db.collection('hotelBookings').insertMany([
      booking(ids.alpha, '1-booked', 2, 5, { reference: 'HTL-CONFIRMED-1' }), // nights d2, d3, d4
      booking(ids.alpha, '1-booked', 5, 6, { reference: 'HTL-CONFIRMED-2' }), // back to back: night d5
      booking(ids.alpha, '1-booked', 6, 8, { status: 'PENDING_PAYMENT', holdExpiresAt: future }), // live hold: no reference yet
      booking(ids.alpha, '1-booked', 8, 10, { status: 'PENDING_PAYMENT', holdExpiresAt: past }), // expired hold: not a claim
      booking(ids.alpha, '1-booked', 10, 12, { status: 'CANCELLED', reference: 'HTL-CANCELLED' }), // cancelled: not a claim
      booking(ids.alpha, '5-both', 8, 10, { reference: 'HTL-BOTH' }), // inside the d0..d11 block
      booking(ids.beta, 'beta-1', 2, 5, { reference: 'HTL-OTHER-HOTEL' }), // other hotel: must never show up
    ]);

    await db.collection('cities').insertMany([{ city_id: 'CAI', name: 'Cairo', country_code: 'EG' }]);
    await insertUser('admin@example.com', { role: Role.ADMIN });
    await insertUser('user@example.com', { role: Role.USER });
    await insertUser('airline@example.com', { role: Role.AIRLINE_MODERATOR, airlineId: new Types.ObjectId() });
    await insertUser('moda@example.com', { role: Role.HOTEL_MODERATOR, hotelId: ids.alpha });
    await insertUser('modb@example.com', { role: Role.HOTEL_MODERATOR, hotelId: ids.beta });
    await insertUser('modghost@example.com', { role: Role.HOTEL_MODERATOR, hotelId: ids.ghost });
    for (const [key, email] of Object.entries({
      admin: 'admin@example.com',
      user: 'user@example.com',
      airline: 'airline@example.com',
      modA: 'moda@example.com',
      modB: 'modb@example.com',
      ghost: 'modghost@example.com',
    })) {
      cookies[key] = await loginCookie(email);
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('who can view', () => {
    it('a guest gets 401', async () => {
      const res = await status(ids.alpha, undefined).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401 });
    });

    it.each([
      ['a traveler', 'user'],
      ['an admin', 'admin'],
      ['an airline moderator', 'airline'],
    ])('%s gets 403', async (_label, key) => {
      const res = await status(ids.alpha, cookies[key]).expect(403);
      expect(res.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
    });

    it("another hotel's moderator gets 403 for an existing hotel, an unknown hotel and a malformed id", async () => {
      for (const id of [ids.alpha.toHexString(), new Types.ObjectId().toHexString(), 'not-an-id']) {
        const res = await status(id, cookies.modB).expect(403);
        expect(res.body).toMatchObject({ statusCode: 403, message: 'You can only view the room status of your own hotel' });
      }
      // And the reverse direction: Alpha's moderator cannot read Beta.
      await status(ids.beta, cookies.modA).expect(403);
    });

    it('a refused request of another hotel never leaks reservation data', async () => {
      const res = await status(ids.alpha, cookies.modB).expect(403);
      expect(JSON.stringify(res.body)).not.toContain('HTL-');
    });

    it("a moderator whose own hotel no longer exists gets 404 in the standard shape", async () => {
      const res = await status(ids.ghost, cookies.ghost).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found', message: 'Hotel not found' });
      expect(res.body.path).toContain('/availability');
    });
  });

  describe('own hotel', () => {
    it('lists the rooms in natural name order with one entry per date, ascending', async () => {
      const res = await status(ids.alpha, cookies.modA).expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 10, total: 7, totalPages: 1 });
      expect(res.body.items.map((r: RoomItem) => r.name)).toEqual(['1-booked', '2-blocked', '3-inactive', '4-partial', '5-both', '9', '10']);
      const expectedDates = Array.from({ length: 12 }, (_, i) => day(i));
      for (const r of res.body.items as RoomItem[]) {
        expect(r.days.map((d) => d.date)).toEqual(expectedDates);
      }
      expect(JSON.stringify(res.body)).not.toContain('HTL-OTHER-HOTEL');
      expect(res.body.items[0]).not.toHaveProperty('nameKey');
    });

    it('each date has exactly one status, one of AVAILABLE / BOOKED / BLOCKED, for every room', async () => {
      const res = await status(ids.alpha, cookies.modA).expect(200);
      for (const r of res.body.items as RoomItem[]) {
        for (const d of r.days) {
          expect(['AVAILABLE', 'BOOKED', 'BLOCKED']).toContain(d.status);
          expect(d.status === 'BOOKED').toBe(d.reservation !== undefined);
          expect(d.status === 'BLOCKED').toBe(d.blockedReason !== undefined);
        }
        expect(new Set(r.days.map((d) => d.date)).size).toBe(r.days.length);
      }
    });

    it('AVAILABLE: a room offered and free for the dates, with no reservation or reason attached', async () => {
      const res = await status(ids.alpha, cookies.modA).expect(200);
      expect(statuses(item(res.body, '9'))).toEqual(Array(12).fill('AVAILABLE'));
      expect(item(res.body, '9').days[0]).toEqual({ date: day(0), status: 'AVAILABLE' });
    });

    it('BOOKED: nights of a confirmed stay carry the reservation reference, back-to-back stays each their own', async () => {
      const res = await status(ids.alpha, cookies.modA).expect(200);
      const days = item(res.body, '1-booked').days;
      expect(statuses(item(res.body, '1-booked'))).toEqual([
        'AVAILABLE', 'AVAILABLE', // d0, d1
        'BOOKED', 'BOOKED', 'BOOKED', // d2..d4  HTL-CONFIRMED-1
        'BOOKED', // d5      HTL-CONFIRMED-2 (check-out day of the first stay is booked by the second)
        'BOOKED', 'BOOKED', // d6, d7  live hold
        'AVAILABLE', 'AVAILABLE', // d8, d9 expired hold
        'AVAILABLE', 'AVAILABLE', // d10, d11 cancelled
      ]);
      expect(days[2].reservation).toMatchObject({
        reference: 'HTL-CONFIRMED-1',
        status: 'CONFIRMED',
        checkIn: day(2),
        checkOut: day(5),
      });
      expect(days[2].reservation?.id).toMatch(/^[0-9a-f]{24}$/);
      expect(days.slice(2, 5).every((d) => d.reservation?.reference === 'HTL-CONFIRMED-1')).toBe(true);
      expect(days[5].reservation?.reference).toBe('HTL-CONFIRMED-2');
    });

    it('BOOKED: an unexpired payment hold counts as booked, with a null reference; expired holds and cancelled stays do not', async () => {
      const res = await status(ids.alpha, cookies.modA).expect(200);
      const days = item(res.body, '1-booked').days;
      expect(days[6].reservation).toMatchObject({ status: 'PENDING_PAYMENT', reference: null });
      expect(days[8].status).toBe('AVAILABLE');
      expect(days[10].status).toBe('AVAILABLE');
    });

    it('BLOCKED: a blocked range (HTL-06 `blockedRanges`), an inactive room and dates outside the availability ranges, each with its reason', async () => {
      const res = await status(ids.alpha, cookies.modA).expect(200);

      const blocked = item(res.body, '2-blocked');
      expect(blocked.days.map((d) => d.status)).toEqual([
        'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'BLOCKED', 'BLOCKED', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE',
      ]);
      expect(blocked.days[3].blockedReason).toBe('BLOCKED_RANGE');

      const inactive = item(res.body, '3-inactive');
      expect(inactive.isActive).toBe(false);
      expect(statuses(inactive)).toEqual(Array(12).fill('BLOCKED'));
      expect(inactive.days.every((d) => d.blockedReason === 'ROOM_DEACTIVATED')).toBe(true);

      const partial = item(res.body, '4-partial');
      expect(statuses(partial)).toEqual([
        'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED',
      ]);
      expect(partial.days[0].blockedReason).toBe('NOT_OFFERED');
      expect(partial.days[8].blockedReason).toBe('NOT_OFFERED'); // d8 is the end day of [d4, d8)
    });

    it('a night that is both booked and blocked is reported once, as BOOKED (the stay exists)', async () => {
      const res = await status(ids.alpha, cookies.modA).expect(200);
      const days = item(res.body, '5-both').days;
      expect(statuses(item(res.body, '5-both'))).toEqual([
        'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BOOKED', 'BOOKED', 'BLOCKED', 'BLOCKED',
      ]);
      expect(days[8].reservation?.reference).toBe('HTL-BOTH');
    });

    it('a stay that starts before the range marks the first dates of the range', async () => {
      const res = await status(ids.alpha, cookies.modA, { from: day(3), to: day(4) }).expect(200);
      expect(res.body.items[0].days).toHaveLength(2);
      expect(item(res.body, '1-booked').days.map((d) => d.reservation?.reference)).toEqual(['HTL-CONFIRMED-1', 'HTL-CONFIRMED-1']);
    });

    it('a single date (from = to) is a valid range; a stay ending on that day is not booked on it', async () => {
      const single = await status(ids.alpha, cookies.modA, { from: day(5), to: day(5) }).expect(200);
      expect(item(single.body, '1-booked').days).toHaveLength(1);
      // d5 is the check-out day of HTL-CONFIRMED-1 but the first night of HTL-CONFIRMED-2.
      expect(item(single.body, '1-booked').days[0].reservation?.reference).toBe('HTL-CONFIRMED-2');
      const free = await status(ids.alpha, cookies.modA, { from: day(1), to: day(1) }).expect(200);
      expect(item(free.body, '1-booked').days[0].status).toBe('AVAILABLE');
    });

    it('a past range is allowed and reports AVAILABLE/BLOCKED without error', async () => {
      const res = await status(ids.alpha, cookies.modA, { from: day(-10), to: day(-8) }).expect(200);
      expect(statuses(item(res.body, '9'))).toEqual(['BLOCKED', 'BLOCKED', 'BLOCKED']);
      expect(item(res.body, '9').days[0].blockedReason).toBe('NOT_OFFERED');
    });

    it('pages the rooms with the shared pagination envelope', async () => {
      const page2 = await status(ids.alpha, cookies.modA, { ...range, page: 2, limit: 3 }).expect(200);
      expect(page2.body).toMatchObject({ page: 2, limit: 3, total: 7, totalPages: 3 });
      expect(page2.body.items.map((r: RoomItem) => r.name)).toEqual(['4-partial', '5-both', '9']);
      const page3 = await status(ids.alpha, cookies.modA, { ...range, page: 3, limit: 3 }).expect(200);
      expect(page3.body.items.map((r: RoomItem) => r.name)).toEqual(['10']);
      // The page only carries the reservations of its own rooms.
      expect(page3.body.items[0].days.every((d: Day) => d.status === 'AVAILABLE')).toBe(true);
    });

    it('the other hotel sees its own rooms and reservation only', async () => {
      const res = await status(ids.beta, cookies.modB).expect(200);
      expect(res.body.items.map((r: RoomItem) => r.name)).toEqual(['beta-1']);
      expect(item(res.body, 'beta-1').days[2].reservation?.reference).toBe('HTL-OTHER-HOTEL');
    });
  });

  describe('invalid date range is a 400 with field-level details', () => {
    const expectInvalid = async (params: Record<string, string | number>, field: string) => {
      const res = await status(ids.alpha, cookies.modA, params).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', message: 'Validation failed' });
      expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field, message: expect.any(String) })]));
      return res.body.details as Array<{ field: string; message: string }>;
    };

    it('missing from and missing to', async () => {
      await expectInvalid({ to: day(3) }, 'from');
      await expectInvalid({ from: day(3) }, 'to');
      const both = await expectInvalid({}, 'from');
      expect(both.map((d) => d.field)).toEqual(expect.arrayContaining(['from', 'to']));
    });

    it('not a real calendar date or wrong format', async () => {
      await expectInvalid({ from: '2027-02-30', to: '2027-03-02' }, 'from');
      await expectInvalid({ from: day(0), to: '2027-13-01' }, 'to');
      await expectInvalid({ from: '10/03/2027', to: day(3) }, 'from');
      await expectInvalid({ from: `${day(0)}T00:00:00Z`, to: day(3) }, 'from');
    });

    it('a reversed range (to before from)', async () => {
      const details = await expectInvalid({ from: day(5), to: day(4) }, 'to');
      expect(details[0].message).toBe('to must not be before from');
    });

    it('a range longer than 62 days is rejected, exactly 62 days is accepted', async () => {
      const details = await expectInvalid({ from: day(0), to: day(62) }, 'to'); // 63 days
      expect(details[0].message).toContain('62');
      const ok = await status(ids.alpha, cookies.modA, { from: day(0), to: day(61) }).expect(200); // 62 days
      expect(ok.body.items[0].days).toHaveLength(62);
    });

    it('bad page or limit', async () => {
      await expectInvalid({ ...range, page: 0 }, 'page');
      await expectInvalid({ ...range, limit: 51 }, 'limit');
    });

    it('an unknown query field is rejected', async () => {
      await expectInvalid({ ...range, roomId: 'x' }, 'roomId');
    });
  });

  describe('routes', () => {
    it('the existing GET /api/hotels/search and GET /api/hotels/:id/rooms/available still answer (not captured by :id/availability)', async () => {
      const search = await http().get(`/api/hotels/search?cityId=CAI&checkIn=${day(1)}&checkOut=${day(3)}&guests=1&rooms=1`);
      expect(search.status).toBe(200);
      expect(search.body).toHaveProperty('items');

      const freeRooms = await http().get(`/api/hotels/${ids.alpha.toHexString()}/rooms/available?checkIn=${day(1)}&checkOut=${day(3)}`);
      expect(freeRooms.status).toBe(200);
      expect(freeRooms.body).toHaveProperty('items');
    });

    it('is documented in Swagger with the query, the paged response and the error codes', async () => {
      const doc = (await http().get('/api/docs-json').expect(200)).body;
      const op = doc.paths['/api/hotels/{id}/availability'].get;
      expect(op.summary).toContain('HTL-08');
      expect(op.parameters.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['id', 'from', 'to', 'page', 'limit']));
      expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['200', '400', '401', '403', '404']));
      expect(JSON.stringify(doc.components.schemas.RoomDayStatusDto)).toContain('BOOKED');
    });
  });
});
