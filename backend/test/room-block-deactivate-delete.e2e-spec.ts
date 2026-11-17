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
import { HotelsModule } from '../src/hotels/hotels.module';
import { HotelBooking } from '../src/hotels/schemas/hotel-booking.schema';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

const PASSWORD = 'Passw0rdOK';
const DAY_MS = 86_400_000;
const day = (offset: number): string => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

describe('HTL-06 block date ranges, deactivate or delete a room (e2e, real MongoDB replica set)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;
  let admin: string;
  let userCookie: string;
  let modA: string;
  let modB: string;
  let modC: string;
  let hotelA: string;
  let hotelB: string;
  let hotelC: string; // has exactly one room, so hotel search shows it only while that room is active
  let roomC: string;
  let travelerId: Types.ObjectId;

  const http = () => request(app.getHttpServer());

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
    return (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  };

  /** A room of hotel A with one availability range covering d1..d60 (so every test stay below is bookable). */
  const addRoom = async (hotelId: string, cookie: string, name: string): Promise<string> => {
    const id = (
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('Cookie', cookie)
        .send({ name, type: 'Double', beds: 2, maxOccupancy: 2, pricePerNightCents: 8000 })
        .expect(201)
    ).body.id as string;
    await http()
      .post(`/api/hotels/${hotelId}/rooms/${id}/availability`)
      .set('Cookie', cookie)
      .send({ startDate: day(1), endDate: day(60) })
      .expect(201);
    return id;
  };

  const patch = (hotelId: string, roomId: string, cookie: string, body: Record<string, unknown>) =>
    http().patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`).set('Cookie', cookie).send(body);
  const block = (hotelId: string, roomId: string, cookie: string, startDate: string, endDate: string) =>
    patch(hotelId, roomId, cookie, { block: { startDate, endDate } });
  const setActive = (hotelId: string, roomId: string, cookie: string, isActive: boolean) => patch(hotelId, roomId, cookie, { isActive });
  const del = (hotelId: string, roomId: string, cookie?: string) => {
    const req = http().delete(`/api/hotels/${hotelId}/rooms/${roomId}`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const hold = (roomId: string, checkIn: string, checkOut: string) =>
    http().post('/api/hotel-bookings').set('Cookie', userCookie).send({ checkIn, checkOut, rooms: [{ roomId, adults: 1, children: 0 }] });
  const storedRoom = (roomId: string) => db.collection('rooms').findOne({ _id: new Types.ObjectId(roomId) });
  const freeRoomIds = async (hotelId: string, checkIn: string, checkOut: string): Promise<string[]> =>
    (await http().get(`/api/hotels/${hotelId}/rooms/available?checkIn=${checkIn}&checkOut=${checkOut}`).expect(200)).body.items.map(
      (r: { roomId: string }) => r.roomId,
    );

  /** A reservation row written directly: lets a test pick any status, hold expiry and dates. */
  const insertBooking = (
    roomId: string,
    hotelId: string,
    checkIn: string,
    checkOut: string,
    status: BookingStatus,
    holdExpiresAt?: Date,
  ) =>
    db.collection('hotelBookings').insertOne({
      userId: travelerId,
      hotelId: new Types.ObjectId(hotelId),
      checkIn,
      checkOut,
      nights: 1,
      rooms: [{ roomId: new Types.ObjectId(roomId), adults: 1, children: 0, name: 'r', type: 'Double', maxOccupancy: 2, pricePerNightCents: 8000, totalCents: 8000 }],
      totalCents: 8000,
      currency: 'USD',
      status,
      ...(holdExpiresAt ? { holdExpiresAt } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }), MongooseModule.forRoot(mongo.getUri()), AuthModule, HotelsModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    await db.model('User').init();
    await db.model('Hotel').init();
    await db.model('Room').init();
    await db.model(HotelBooking.name).init();

    await db.collection('cities').insertMany([{ city_id: 'CAI', name: 'Cairo', country_code: 'EG' }]);
    await insertUser('admin@example.com', { role: Role.ADMIN });
    admin = await loginCookie('admin@example.com');
    const hotel = (name: string) => ({ name, address: '12 Corniche', cityId: 'CAI', description: 'Hotel.', starRating: 4 });
    hotelA = (await http().post('/api/hotels').set('Cookie', admin).send(hotel('Hotel A')).expect(201)).body.id;
    hotelB = (await http().post('/api/hotels').set('Cookie', admin).send(hotel('Hotel B')).expect(201)).body.id;
    hotelC = (await http().post('/api/hotels').set('Cookie', admin).send(hotel('Hotel C')).expect(201)).body.id;

    travelerId = (await insertUser('user@example.com', { role: Role.USER })).insertedId;
    await insertUser('moda@example.com', { role: Role.HOTEL_MODERATOR, hotelId: new Types.ObjectId(hotelA) });
    await insertUser('modb@example.com', { role: Role.HOTEL_MODERATOR, hotelId: new Types.ObjectId(hotelB) });
    userCookie = await loginCookie('user@example.com');
    modA = await loginCookie('moda@example.com');
    modB = await loginCookie('modb@example.com');
    await insertUser('modc@example.com', { role: Role.HOTEL_MODERATOR, hotelId: new Types.ObjectId(hotelC) });
    modC = await loginCookie('modc@example.com');
    roomC = await addRoom(hotelC, modC, 'only-room');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await db.collection('hotelBookings').deleteMany({});
  });

  describe('block a date range (PATCH .../availability { block })', () => {
    it('blocks dates: 200 with the range, stored on the room, and the blocked nights are no longer bookable or listed', async () => {
      const room = await addRoom(hotelA, modA, 'B-happy');
      const res = await block(hotelA, room, modA, day(10), day(13)).expect(200);
      expect(res.body).toMatchObject({ roomId: room, hotelId: hotelA, startDate: day(10), endDate: day(13) });
      expect(typeof res.body.id).toBe('string');
      expect((await storedRoom(room))?.blockedRanges).toHaveLength(1);

      // Search side (HTL-15 uses the same findFreeRooms as hotel search): any overlap hides the room, other nights do not.
      expect(await freeRoomIds(hotelA, day(11), day(12))).not.toContain(room);
      expect(await freeRoomIds(hotelA, day(9), day(11))).not.toContain(room);
      expect(await freeRoomIds(hotelA, day(12), day(15))).not.toContain(room);
      expect(await freeRoomIds(hotelA, day(7), day(10))).toContain(room); // ends on the first blocked day (check-out)
      expect(await freeRoomIds(hotelA, day(13), day(15))).toContain(room); // starts on the day the block ends

      // Hold side (HTL-18): the booking refuses a blocked room, accepts the adjacent dates.
      await hold(room, day(11), day(12)).expect(409);
      await hold(room, day(7), day(10)).expect(201);
    });

    it('is rejected (409) over a CONFIRMED reservation and over an unexpired PENDING_PAYMENT hold, and nothing is stored', async () => {
      const room = await addRoom(hotelA, modA, 'B-conflict');
      await insertBooking(room, hotelA, day(20), day(23), BookingStatus.CONFIRMED);
      await insertBooking(room, hotelA, day(30), day(33), BookingStatus.PENDING_PAYMENT, new Date(Date.now() + 10 * 60_000));

      await block(hotelA, room, modA, day(22), day(25)).expect(409); // overlaps the tail of the confirmed stay
      await block(hotelA, room, modA, day(19), day(24)).expect(409); // contains it
      await block(hotelA, room, modA, day(31), day(32)).expect(409); // inside the live hold
      expect((await storedRoom(room))?.blockedRanges ?? []).toHaveLength(0);
    });

    it('is allowed next to a reservation, and over bookings that no longer count (expired hold, EXPIRED, CANCELLED)', async () => {
      const room = await addRoom(hotelA, modA, 'B-allowed');
      await insertBooking(room, hotelA, day(20), day(23), BookingStatus.CONFIRMED);
      await insertBooking(room, hotelA, day(30), day(33), BookingStatus.PENDING_PAYMENT, new Date(Date.now() - 60_000)); // hold already expired
      await insertBooking(room, hotelA, day(35), day(38), BookingStatus.EXPIRED);
      await insertBooking(room, hotelA, day(40), day(43), BookingStatus.CANCELLED);

      await block(hotelA, room, modA, day(23), day(25)).expect(200); // starts on the check-out day of the confirmed stay
      await block(hotelA, room, modA, day(18), day(20)).expect(200); // ends on its check-in day
      await block(hotelA, room, modA, day(30), day(33)).expect(200);
      await block(hotelA, room, modA, day(35), day(38)).expect(200);
      await block(hotelA, room, modA, day(40), day(43)).expect(200);
    });

    it('409 when it overlaps another block of the room; adjacent blocks are fine', async () => {
      const room = await addRoom(hotelA, modA, 'B-overlap');
      await block(hotelA, room, modA, day(10), day(13)).expect(200);
      await block(hotelA, room, modA, day(12), day(15)).expect(409);
      await block(hotelA, room, modA, day(9), day(11)).expect(409);
      await block(hotelA, room, modA, day(13), day(15)).expect(200);
      expect((await storedRoom(room))?.blockedRanges).toHaveLength(2);
    });

    it('a block survives later availability changes (it is an override, not a hole in the availability)', async () => {
      const room = await addRoom(hotelA, modA, 'B-survive');
      await block(hotelA, room, modA, day(10), day(12)).expect(200);
      const rangeId = (await storedRoom(room))?.availability[0]._id.toString();
      await patch(hotelA, room, modA, { rangeId, endDate: day(70) }).expect(200);
      expect(await freeRoomIds(hotelA, day(10), day(12))).not.toContain(room);
    });

    it('400 for invalid input: endDate not after startDate, impossible date, missing field, unknown field', async () => {
      const room = await addRoom(hotelA, modA, 'B-400');
      const same = await block(hotelA, room, modA, day(10), day(10)).expect(400);
      expect(same.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
      await block(hotelA, room, modA, day(12), day(10)).expect(400);
      await block(hotelA, room, modA, '2027-02-30', '2027-03-02').expect(400);
      await patch(hotelA, room, modA, { block: { startDate: day(10) } }).expect(400);
      await patch(hotelA, room, modA, { block: { startDate: day(10), endDate: day(12), reason: 'x' } }).expect(400);
      await patch(hotelA, room, modA, { block: 'nope' }).expect(400);
      await patch(hotelA, room, modA, { block: null }).expect(400);
    });

    it('400 unless the body asks for exactly one action (nothing, or two at once)', async () => {
      const room = await addRoom(hotelA, modA, 'B-one-action');
      const rangeId = (await storedRoom(room))?.availability[0]._id.toString();
      await patch(hotelA, room, modA, {}).expect(400);
      await patch(hotelA, room, modA, { block: { startDate: day(10), endDate: day(12) }, isActive: false }).expect(400);
      await patch(hotelA, room, modA, { block: { startDate: day(10), endDate: day(12) }, rangeId, startDate: day(2) }).expect(400);
      await patch(hotelA, room, modA, { startDate: day(2) }).expect(400); // HTL-05 still needs the rangeId
      const stored = await storedRoom(room);
      expect(stored?.blockedRanges ?? []).toHaveLength(0);
      expect(stored?.isActive).toBe(true);
    });
  });

  describe('deactivate / reactivate a room (PATCH .../availability { isActive })', () => {
    it('deactivates: 200 isActive=false, the room leaves the free-rooms list and cannot be held; reactivating brings it back', async () => {
      const room = await addRoom(hotelA, modA, 'D-happy');
      expect(await freeRoomIds(hotelA, day(5), day(7))).toContain(room);

      const off = await setActive(hotelA, room, modA, false).expect(200);
      expect(off.body).toMatchObject({ id: room, hotelId: hotelA, isActive: false });
      expect(await freeRoomIds(hotelA, day(5), day(7))).not.toContain(room);
      await hold(room, day(5), day(7)).expect(409);

      const on = await setActive(hotelA, room, modA, true).expect(200);
      expect(on.body.isActive).toBe(true);
      expect(await freeRoomIds(hotelA, day(5), day(7))).toContain(room);
    });

    it('hotel search (HTL-11) skips a hotel whose only room is deactivated, and finds it again after reactivation', async () => {
      const search = async (): Promise<string[]> =>
        (await http().get(`/api/hotels/search?cityId=CAI&checkIn=${day(5)}&checkOut=${day(7)}&guests=1`).expect(200)).body.items.map(
          (h: { id: string }) => h.id,
        );
      expect(await search()).toContain(hotelC);
      await setActive(hotelC, roomC, modC, false).expect(200);
      expect(await search()).not.toContain(hotelC);
      await setActive(hotelC, roomC, modC, true).expect(200);
      expect(await search()).toContain(hotelC);
    });

    it('deactivating an already inactive room answers 200 (no conflict)', async () => {
      const room = await addRoom(hotelA, modA, 'D-twice');
      await setActive(hotelA, room, modA, false).expect(200);
      await setActive(hotelA, room, modA, false).expect(200);
    });

    it('is rejected (409) while a CONFIRMED reservation or an unexpired PENDING_PAYMENT hold has not ended; the room stays active', async () => {
      const confirmedRoom = await addRoom(hotelA, modA, 'D-confirmed');
      await insertBooking(confirmedRoom, hotelA, day(30), day(32), BookingStatus.CONFIRMED);
      await setActive(hotelA, confirmedRoom, modA, false).expect(409);
      expect((await storedRoom(confirmedRoom))?.isActive).toBe(true);

      const heldRoom = await addRoom(hotelA, modA, 'D-held');
      await insertBooking(heldRoom, hotelA, day(30), day(32), BookingStatus.PENDING_PAYMENT, new Date(Date.now() + 10 * 60_000));
      await setActive(hotelA, heldRoom, modA, false).expect(409);

      // A real hold created through the API counts the same.
      const apiHeldRoom = await addRoom(hotelA, modA, 'D-api-held');
      await hold(apiHeldRoom, day(8), day(9)).expect(201);
      await setActive(hotelA, apiHeldRoom, modA, false).expect(409);
    });

    it('is allowed when nothing counts any more: stays that ended, EXPIRED/CANCELLED bookings and an expired hold', async () => {
      const room = await addRoom(hotelA, modA, 'D-allowed');
      await insertBooking(room, hotelA, day(-10), day(-7), BookingStatus.CONFIRMED); // already over
      await insertBooking(room, hotelA, day(30), day(32), BookingStatus.CANCELLED);
      await insertBooking(room, hotelA, day(33), day(34), BookingStatus.EXPIRED);
      await insertBooking(room, hotelA, day(35), day(36), BookingStatus.PENDING_PAYMENT, new Date(Date.now() - 60_000));
      await setActive(hotelA, room, modA, false).expect(200);
    });

    it('400 for a non-boolean isActive', async () => {
      const room = await addRoom(hotelA, modA, 'D-400');
      await patch(hotelA, room, modA, { isActive: 'false' }).expect(400);
      await patch(hotelA, room, modA, { isActive: null }).expect(400);
    });
  });

  describe('delete a room (DELETE /hotels/:id/rooms/:roomId)', () => {
    it('deletes a never-reserved room: 204 and it is gone (also from the free-rooms list)', async () => {
      const room = await addRoom(hotelA, modA, 'X-happy');
      await del(hotelA, room, modA).expect(204);
      expect(await storedRoom(room)).toBeNull();
      expect(await freeRoomIds(hotelA, day(5), day(7))).not.toContain(room);
      await del(hotelA, room, modA).expect(404); // second time: unknown room
    });

    it.each([
      [BookingStatus.CONFIRMED, undefined],
      [BookingStatus.PENDING_PAYMENT, new Date(Date.now() + 10 * 60_000)],
      [BookingStatus.PENDING_PAYMENT, new Date(Date.now() - 60_000)],
      [BookingStatus.COMPLETED, undefined],
      [BookingStatus.CANCELLED, undefined],
      [BookingStatus.EXPIRED, undefined],
    ])('409 for a room that was ever reserved (%s), even a past stay, and the room is kept', async (status, holdExpiresAt) => {
      const room = await addRoom(hotelA, modA, `X-${status}-${holdExpiresAt ? holdExpiresAt.getTime() : 'none'}`);
      await insertBooking(room, hotelA, day(-20), day(-18), status, holdExpiresAt);
      const res = await del(hotelA, room, modA).expect(409);
      expect(res.body).toMatchObject({ statusCode: 409 });
      expect(await storedRoom(room)).not.toBeNull();
    });

    it('a room that was reserved through the API can no longer be deleted', async () => {
      const room = await addRoom(hotelA, modA, 'X-api');
      await hold(room, day(5), day(6)).expect(201);
      await del(hotelA, room, modA).expect(409);
    });

    it('404 for an unknown or malformed room id, and for a room of another hotel (even a reserved one: no 409 leak)', async () => {
      const otherRoom = await addRoom(hotelB, modB, 'X-hotel-b');
      await insertBooking(otherRoom, hotelB, day(5), day(6), BookingStatus.CONFIRMED);
      await del(hotelA, String(new Types.ObjectId()), modA).expect(404);
      await del(hotelA, 'not-an-id', modA).expect(404);
      await del(hotelA, otherRoom, modA).expect(404);
      expect(await storedRoom(otherRoom)).not.toBeNull();
    });
  });

  describe('who may do it', () => {
    let room: string;
    let roomB: string;
    beforeAll(async () => {
      room = await addRoom(hotelA, modA, 'W-room');
      roomB = await addRoom(hotelB, modB, 'W-room-b');
    });

    it('401 without a login, for all three actions', async () => {
      await http().patch(`/api/hotels/${hotelA}/rooms/${room}/availability`).send({ isActive: false }).expect(401);
      await http().patch(`/api/hotels/${hotelA}/rooms/${room}/availability`).send({ block: { startDate: day(3), endDate: day(4) } }).expect(401);
      await del(hotelA, room).expect(401);
    });

    it('403 for a traveler, an admin and the moderator of another hotel; nothing changes', async () => {
      for (const cookie of [userCookie, admin, modB]) {
        await setActive(hotelA, room, cookie, false).expect(403);
        await block(hotelA, room, cookie, day(3), day(4)).expect(403);
        await del(hotelA, room, cookie).expect(403);
      }
      // The moderator of hotel A on hotel B's id (and on an unknown hotel id): same 403 as HTL-01/03.
      await setActive(hotelB, roomB, modA, false).expect(403);
      await block(hotelB, roomB, modA, day(3), day(4)).expect(403);
      await del(hotelB, roomB, modA).expect(403);
      await del(String(new Types.ObjectId()), room, modA).expect(403);

      const stored = await storedRoom(room);
      expect(stored?.isActive).toBe(true);
      expect(stored?.blockedRanges ?? []).toHaveLength(0);
      expect(await storedRoom(roomB)).not.toBeNull();
    });

    it('404 when the room exists only in another hotel (own hotel id, foreign room id)', async () => {
      await setActive(hotelA, roomB, modA, false).expect(404);
      await block(hotelA, roomB, modA, day(3), day(4)).expect(404);
      expect((await storedRoom(roomB))?.isActive).toBe(true);
    });

    it('404 for an unknown or malformed room id', async () => {
      await setActive(hotelA, String(new Types.ObjectId()), modA, false).expect(404);
      await block(hotelA, 'not-an-id', modA, day(3), day(4)).expect(404);
    });
  });

  describe('concurrency (the reservation check and the write must not interleave)', () => {
    it('two overlapping blocks sent at once: exactly one wins', async () => {
      const room = await addRoom(hotelA, modA, 'C-blocks');
      const results = await Promise.all([block(hotelA, room, modA, day(10), day(14)), block(hotelA, room, modA, day(12), day(16))]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await storedRoom(room))?.blockedRanges).toHaveLength(1);
    });

    it('a block racing a hold on the same nights: they never both succeed', async () => {
      for (let i = 0; i < 6; i++) {
        const room = await addRoom(hotelA, modA, `C-block-hold-${i}`);
        const [blocked, held] = await Promise.all([block(hotelA, room, modA, day(10), day(12)), hold(room, day(10), day(12))]);
        expect(blocked.status === 200 && held.status === 201).toBe(false);
        expect([200, 409]).toContain(blocked.status);
        expect([201, 409]).toContain(held.status);
        // Whatever won, the other one must have been refused, not dropped silently.
        expect(blocked.status === 200 || held.status === 201).toBe(true);
      }
    });

    it('a deactivation racing a hold: they never both succeed', async () => {
      for (let i = 0; i < 6; i++) {
        const room = await addRoom(hotelA, modA, `C-off-hold-${i}`);
        const [off, held] = await Promise.all([setActive(hotelA, room, modA, false), hold(room, day(10), day(12))]);
        expect(off.status === 200 && held.status === 201).toBe(false);
        expect(off.status === 200 || held.status === 201).toBe(true);
      }
    });

    it('a delete racing a hold: a deleted room is never reserved, a reserved room is never deleted', async () => {
      for (let i = 0; i < 6; i++) {
        const room = await addRoom(hotelA, modA, `C-del-hold-${i}`);
        const [deleted, held] = await Promise.all([del(hotelA, room, modA), hold(room, day(10), day(12))]);
        expect(deleted.status === 204 && held.status === 201).toBe(false);
        expect(deleted.status === 204 || held.status === 201).toBe(true);
        const bookings = await db.collection('hotelBookings').countDocuments({ 'rooms.roomId': new Types.ObjectId(room) });
        expect(bookings).toBe(deleted.status === 204 ? 0 : 1);
        if (deleted.status === 204) expect(await storedRoom(room)).toBeNull();
        else expect(await storedRoom(room)).not.toBeNull();
        await db.collection('hotelBookings').deleteMany({});
      }
    });
  });
});
