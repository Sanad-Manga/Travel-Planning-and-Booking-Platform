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
import { RoomReservations } from '../src/hotels/room-reservations';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

describe('HTL-05 edit room and availability (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());

  // Stand-in for Hessain's hotel bookings (HTL-16): confirmed reservations as half-open [checkIn, checkOut).
  const confirmed: Array<{ roomId: string; checkIn: string; checkOut: string }> = [];
  const fakeReservations = {
    hasConfirmedReservation: async (roomId: string, startDate: string, endDate: string) =>
      confirmed.some((r) => r.roomId === roomId && r.checkIn < endDate && r.checkOut > startDate),
  };

  const insertUser = (email: string, extra: Record<string, unknown>) =>
    connection.collection('users').insertOne({
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

  const addRoom = async (hotelId: string, cookie: string, name: string): Promise<string> =>
    (
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('Cookie', cookie)
        .send({ name, type: 'Double', beds: 2, maxOccupancy: 2, pricePerNightCents: 8000 })
        .expect(201)
    ).body.id;

  const addRange = async (hotelId: string, roomId: string, cookie: string, startDate: string, endDate: string): Promise<string> =>
    (
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', cookie)
        .send({ startDate, endDate })
        .expect(201)
    ).body.id;

  const editRoom = (hotelId: string, roomId: string, cookie: string, body: Record<string, unknown>) =>
    http().patch(`/api/hotels/${hotelId}/rooms/${roomId}`).set('Cookie', cookie).send(body);
  const editRange = (hotelId: string, roomId: string, cookie: string, body: Record<string, unknown>) =>
    http().patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`).set('Cookie', cookie).send(body);
  const storedRanges = async (roomId: string) =>
    ((await connection.collection('rooms').findOne({ _id: new Types.ObjectId(roomId) }))?.availability ?? []) as Array<{
      _id: Types.ObjectId;
      startDate: string;
      endDate: string;
    }>;

  let admin: string;
  let userCookie: string;
  let modA: string;
  let modB: string;
  let hotelA: string;
  let hotelB: string;
  let roomB1: string;

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
      .useValue(fakeReservations)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('Hotel').init();
    await connection.model('Room').init();

    await connection.collection('cities').insertMany([{ city_id: 'CAI', name: 'Cairo', country_code: 'EG' }]);

    await insertUser('admin@example.com', { role: Role.ADMIN });
    admin = await loginCookie('admin@example.com');
    const hotel = (name: string) => ({ name, address: '12 Corniche', cityId: 'CAI', description: 'Hotel.', starRating: 4 });
    hotelA = (await http().post('/api/hotels').set('Cookie', admin).send(hotel('Hotel A')).expect(201)).body.id;
    hotelB = (await http().post('/api/hotels').set('Cookie', admin).send(hotel('Hotel B')).expect(201)).body.id;

    await insertUser('user@example.com', { role: Role.USER });
    await insertUser('moda@example.com', { role: Role.HOTEL_MODERATOR, hotelId: new Types.ObjectId(hotelA) });
    await insertUser('modb@example.com', { role: Role.HOTEL_MODERATOR, hotelId: new Types.ObjectId(hotelB) });
    userCookie = await loginCookie('user@example.com');
    modA = await loginCookie('moda@example.com');
    modB = await loginCookie('modb@example.com');
    roomB1 = await addRoom(hotelB, modB, '201');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  describe('PATCH /api/hotels/:id/rooms/:roomId', () => {
    let room: string;
    beforeAll(async () => {
      room = await addRoom(hotelA, modA, 'Edit me');
    });

    it('edits beds, occupancy and price (partial), price stays integer cents, name and type unchanged', async () => {
      const res = await editRoom(hotelA, room, modA, { beds: 3, maxOccupancy: 4, pricePerNightCents: 9900 }).expect(200);
      expect(res.body).toMatchObject({ id: room, name: 'Edit me', type: 'Double', beds: 3, maxOccupancy: 4, pricePerNightCents: 9900, currency: 'USD' });
      const only = await editRoom(hotelA, room, modA, { pricePerNightCents: 12000 }).expect(200);
      expect(only.body).toMatchObject({ beds: 3, maxOccupancy: 4, pricePerNightCents: 12000 });
      const stored = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(room) });
      expect(Number.isInteger(stored?.pricePerNightCents)).toBe(true);
    });

    it('a price change touches nothing but the room (a booking snapshot in another collection keeps its price)', async () => {
      const bookings = connection.collection('hotelbookings_stub');
      const { insertedId } = await bookings.insertOne({ roomId: new Types.ObjectId(room), pricePerNightCents: 12000, totalCents: 36000 });
      await editRoom(hotelA, room, modA, { pricePerNightCents: 15000 }).expect(200);
      const booking = await bookings.findOne({ _id: insertedId });
      expect(booking).toMatchObject({ pricePerNightCents: 12000, totalCents: 36000 });
    });

    it('400 like HTL-03: occupancy < 1, price <= 0 or fractional, beds < 1', async () => {
      for (const body of [{ maxOccupancy: 0 }, { pricePerNightCents: 0 }, { pricePerNightCents: -5 }, { pricePerNightCents: 85.5 }, { beds: 0 }, { pricePerNightCents: '9000' }]) {
        const res = await editRoom(hotelA, room, modA, body).expect(400);
        expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
      }
      const stored = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(room) });
      expect(stored?.pricePerNightCents).toBe(15000);
    });

    it('400 for an empty body and for fields that are not editable (name, type, isActive, hotelId, availability)', async () => {
      await editRoom(hotelA, room, modA, {}).expect(400);
      for (const body of [{ name: 'New' }, { type: 'Suite' }, { isActive: false }, { hotelId: hotelB }, { availability: [] }]) {
        await editRoom(hotelA, room, modA, body).expect(400);
      }
    });

    it('404 for an unknown, malformed or other-hotel room', async () => {
      await editRoom(hotelA, String(new Types.ObjectId()), modA, { beds: 1 }).expect(404);
      await editRoom(hotelA, 'not-an-id', modA, { beds: 1 }).expect(404);
      await editRoom(hotelA, roomB1, modA, { beds: 1 }).expect(404);
    });

    it("403 for another moderator's hotel, unknown/malformed hotel id, user, admin; 401 without login", async () => {
      await editRoom(hotelB, roomB1, modA, { beds: 1 }).expect(403);
      await editRoom(String(new Types.ObjectId()), room, modA, { beds: 1 }).expect(403);
      await editRoom('not-an-id', room, modA, { beds: 1 }).expect(403);
      await editRoom(hotelA, room, userCookie, { beds: 1 }).expect(403);
      await editRoom(hotelA, room, admin, { beds: 1 }).expect(403);
      await http().patch(`/api/hotels/${hotelA}/rooms/${room}`).send({ beds: 1 }).expect(401);
      const other = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(roomB1) });
      expect(other?.beds).toBe(2);
    });
  });

  describe('PATCH /api/hotels/:id/rooms/:roomId/availability', () => {
    let room: string;
    let r1: string; // [2027-01-01, 2027-01-10)
    let r2: string; // [2027-01-10, 2027-01-20)

    beforeAll(async () => {
      room = await addRoom(hotelA, modA, 'Avail');
      r1 = await addRange(hotelA, room, modA, '2027-01-01', '2027-01-10');
      r2 = await addRange(hotelA, room, modA, '2027-01-10', '2027-01-20');
      confirmed.push({ roomId: room, checkIn: '2027-01-04', checkOut: '2027-01-06' });
    });

    it('shrinks a range where no reservation is, and the stored range changes', async () => {
      const res = await editRange(hotelA, room, modA, { rangeId: r1, startDate: '2027-01-02' }).expect(200);
      expect(res.body).toEqual({ id: r1, roomId: room, hotelId: hotelA, startDate: '2027-01-02', endDate: '2027-01-10' });
      expect((await storedRanges(room)).find((r) => r._id.toString() === r1)).toMatchObject({ startDate: '2027-01-02', endDate: '2027-01-10' });
    });

    it('sending the dates the range already has is 200 and changes nothing (not a false 409)', async () => {
      const res = await editRange(hotelA, room, modA, { rangeId: r1, startDate: '2027-01-02', endDate: '2027-01-10' }).expect(200);
      expect(res.body).toEqual({ id: r1, roomId: room, hotelId: hotelA, startDate: '2027-01-02', endDate: '2027-01-10' });
      expect((await storedRanges(room)).find((r) => r._id.toString() === r1)).toMatchObject({ startDate: '2027-01-02', endDate: '2027-01-10' });
    });

    it('409 when the removed dates have a confirmed reservation, and nothing changes', async () => {
      // removes 2027-01-02..2027-01-07 which contains the reservation 01-04..01-06
      const res = await editRange(hotelA, room, modA, { rangeId: r1, startDate: '2027-01-07' }).expect(409);
      expect(res.body.message).toMatch(/confirmed reservation/);
      await editRange(hotelA, room, modA, { rangeId: r1, endDate: '2027-01-05' }).expect(409); // cuts the tail 01-05..01-10
      expect((await storedRanges(room)).find((r) => r._id.toString() === r1)).toMatchObject({ startDate: '2027-01-02', endDate: '2027-01-10' });
    });

    it('shrinking so the reservation stays inside is allowed; extending never needs the check', async () => {
      await editRange(hotelA, room, modA, { rangeId: r1, startDate: '2027-01-03', endDate: '2027-01-08' }).expect(200);
      await editRange(hotelA, room, modA, { rangeId: r1, startDate: '2026-12-20' }).expect(200); // extends to the left, no overlap
    });

    it('moving a range away from a reservation (whole old range removed) is rejected too', async () => {
      await editRange(hotelA, room, modA, { rangeId: r1, startDate: '2026-12-01', endDate: '2026-12-10' }).expect(409);
    });

    it('only the removed nights matter: another part of the room can be shrunk freely', async () => {
      // the reservation is 01-04..01-06 (nights 01-04 and 01-05); starting r1 at 01-06 removes those nights
      await editRange(hotelA, room, modA, { rangeId: r1, startDate: '2027-01-06' }).expect(409);
      // r2 starts at 01-10: removing 01-10..01-12 touches no reservation
      await editRange(hotelA, room, modA, { rangeId: r2, startDate: '2027-01-12' }).expect(200);
    });

    it('409 when the new dates overlap ANOTHER range of the room; the range itself may overlap its own old dates', async () => {
      // r1 is now [2026-12-20, 2027-01-08), r2 is [2027-01-12, 2027-01-20)
      await editRange(hotelA, room, modA, { rangeId: r1, endDate: '2027-01-13' }).expect(409);
      await editRange(hotelA, room, modA, { rangeId: r1, endDate: '2027-01-12' }).expect(200); // touches r2, adjacent
      expect((await storedRanges(room)).find((r) => r._id.toString() === r2)).toMatchObject({ startDate: '2027-01-12', endDate: '2027-01-20' });
    });

    it('400 when endDate is not after startDate (also against the kept value), no date sent, bad dates, unknown fields, bad rangeId', async () => {
      const bad = await editRange(hotelA, room, modA, { rangeId: r2, startDate: '2027-01-25' }).expect(400);
      expect(bad.body.details).toEqual([{ field: 'endDate', message: 'endDate must be after startDate' }]);
      await editRange(hotelA, room, modA, { rangeId: r2, startDate: '2027-01-15', endDate: '2027-01-15' }).expect(400);
      await editRange(hotelA, room, modA, { rangeId: r2 }).expect(400);
      await editRange(hotelA, room, modA, { rangeId: r2, startDate: '2027-02-30' }).expect(400);
      await editRange(hotelA, room, modA, { rangeId: r2, startDate: '2027-01-14', roomId: room }).expect(400);
      await editRange(hotelA, room, modA, { startDate: '2027-01-14' }).expect(400);
      await editRange(hotelA, room, modA, { rangeId: 'nope', startDate: '2027-01-14' }).expect(400);
    });

    it('404 for an unknown range, a range of another room, an unknown/other-hotel room', async () => {
      const otherRoom = await addRoom(hotelA, modA, 'Other room');
      const otherRange = await addRange(hotelA, otherRoom, modA, '2027-05-01', '2027-05-05');
      await editRange(hotelA, room, modA, { rangeId: String(new Types.ObjectId()), startDate: '2027-01-14' }).expect(404);
      await editRange(hotelA, room, modA, { rangeId: otherRange, startDate: '2027-01-14' }).expect(404);
      await editRange(hotelA, String(new Types.ObjectId()), modA, { rangeId: r2, startDate: '2027-01-14' }).expect(404);
      await editRange(hotelA, 'not-an-id', modA, { rangeId: r2, startDate: '2027-01-14' }).expect(404);
      await editRange(hotelA, roomB1, modA, { rangeId: r2, startDate: '2027-01-14' }).expect(404);
    });

    it("403 for another moderator's hotel, user, admin; 401 without login", async () => {
      await editRange(hotelB, roomB1, modA, { rangeId: r2, startDate: '2027-01-14' }).expect(403);
      await editRange(String(new Types.ObjectId()), room, modA, { rangeId: r2, startDate: '2027-01-14' }).expect(403);
      await editRange(hotelA, room, userCookie, { rangeId: r2, startDate: '2027-01-14' }).expect(403);
      await editRange(hotelA, room, admin, { rangeId: r2, startDate: '2027-01-14' }).expect(403);
      await http().patch(`/api/hotels/${hotelA}/rooms/${room}/availability`).send({ rangeId: r2, startDate: '2027-01-14' }).expect(401);
    });

    it('concurrent edits that would overlap each other: the room never ends up with overlapping ranges', async () => {
      const raceRoom = await addRoom(hotelA, modA, 'Race');
      const a = await addRange(hotelA, raceRoom, modA, '2028-01-01', '2028-01-05');
      const b = await addRange(hotelA, raceRoom, modA, '2028-01-10', '2028-01-15');
      // both grow towards the middle and would overlap if both applied: [01-01, 01-12) vs [01-08, 01-15)
      const [x, y] = await Promise.all([
        editRange(hotelA, raceRoom, modA, { rangeId: a, endDate: '2028-01-12' }),
        editRange(hotelA, raceRoom, modA, { rangeId: b, startDate: '2028-01-08' }),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      const [r, s] = (await storedRanges(raceRoom)).sort((p, q) => p.startDate.localeCompare(q.startDate));
      expect(r.endDate <= s.startDate).toBe(true);
    });

    it('concurrent edits of the SAME range: both read the same dates, only one applies per version', async () => {
      const raceRoom = await addRoom(hotelA, modA, 'Race2');
      const a = await addRange(hotelA, raceRoom, modA, '2029-01-01', '2029-01-10');
      const results = await Promise.all([
        editRange(hotelA, raceRoom, modA, { rangeId: a, endDate: '2029-01-12' }),
        editRange(hotelA, raceRoom, modA, { rangeId: a, endDate: '2029-01-14' }),
      ]);
      const ok = results.filter((r) => r.status === 200);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
      const final = (await storedRanges(raceRoom))[0];
      expect(['2029-01-12', '2029-01-14']).toContain(final.endDate);
    });
  });
});
