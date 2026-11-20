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
import { ROOM_MAX_AVAILABILITY_RANGES } from '../src/hotels/hotels.constants';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

describe('HTL-04 room availability ranges (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());

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

  const addRange = (hotelId: string, roomId: string, cookie: string, body: Record<string, unknown>) =>
    http().post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`).set('Cookie', cookie).send(body);

  let admin: string;
  let userCookie: string;
  let modA: string;
  let modB: string;
  let hotelA: string;
  let hotelB: string;
  let roomA1: string; // used by the overlap tests
  let roomA2: string;
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
    }).compile();
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

    roomA1 = await addRoom(hotelA, modA, '101');
    roomA2 = await addRoom(hotelA, modA, '102');
    roomB1 = await addRoom(hotelB, modB, '201');
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  it('moderator defines a range for their own room', async () => {
    const res = await addRange(hotelA, roomA1, modA, { startDate: '2026-12-01', endDate: '2026-12-10' }).expect(201);
    expect(res.body).toMatchObject({ roomId: roomA1, hotelId: hotelA, startDate: '2026-12-01', endDate: '2026-12-10' });
    expect(typeof res.body.id).toBe('string');

    const stored = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(roomA1) });
    expect(stored?.availability).toHaveLength(1);
    expect(stored?.availability[0]).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-10' });
  });

  it('409 for every kind of overlap with an existing range of the same room', async () => {
    // existing: [2026-12-01, 2026-12-10)
    const overlapping = [
      ['2026-12-01', '2026-12-10'], // identical
      ['2026-12-05', '2026-12-08'], // inside
      ['2026-11-25', '2026-12-02'], // overlaps the start
      ['2026-12-09', '2026-12-20'], // overlaps the end
      ['2026-11-01', '2027-01-01'], // contains it
    ];
    for (const [startDate, endDate] of overlapping) {
      const res = await addRange(hotelA, roomA1, modA, { startDate, endDate }).expect(409);
      expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
    }
    const stored = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(roomA1) });
    expect(stored?.availability).toHaveLength(1);
  });

  it('adjacent ranges are allowed (check-out day = next check-in day) and so are gaps', async () => {
    await addRange(hotelA, roomA1, modA, { startDate: '2026-12-10', endDate: '2026-12-15' }).expect(201);
    await addRange(hotelA, roomA1, modA, { startDate: '2026-11-20', endDate: '2026-12-01' }).expect(201);
    await addRange(hotelA, roomA1, modA, { startDate: '2027-01-10', endDate: '2027-01-20' }).expect(201);
    // the gap [2026-12-15, 2027-01-10) can still be filled, but not partly past its edges
    await addRange(hotelA, roomA1, modA, { startDate: '2026-12-14', endDate: '2026-12-20' }).expect(409);
    await addRange(hotelA, roomA1, modA, { startDate: '2026-12-15', endDate: '2027-01-10' }).expect(201);
  });

  it('the same dates are fine on a different room, in the same or another hotel', async () => {
    await addRange(hotelA, roomA2, modA, { startDate: '2026-12-01', endDate: '2026-12-10' }).expect(201);
    await addRange(hotelB, roomB1, modB, { startDate: '2026-12-01', endDate: '2026-12-10' }).expect(201);
  });

  it('400 when endDate is not after startDate (equal or earlier)', async () => {
    for (const endDate of ['2026-06-10', '2026-06-09']) {
      const res = await addRange(hotelA, roomA2, modA, { startDate: '2026-06-10', endDate }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
      expect(res.body.details).toEqual([{ field: 'endDate', message: 'endDate must be after startDate' }]);
    }
  });

  it('400 for missing, malformed, impossible and non-string dates, and unknown fields', async () => {
    const res = await addRange(hotelA, roomA2, modA, {}).expect(400);
    expect(res.body.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['startDate', 'endDate']));
    for (const bad of ['2026-02-30', '2026-13-01', '01/06/2026', '2026-6-1', '2026-06-01T00:00:00Z', 20260601, null]) {
      await addRange(hotelA, roomA2, modA, { startDate: bad, endDate: '2027-06-10' }).expect(400);
    }
    await addRange(hotelA, roomA2, modA, { startDate: '2027-06-01', endDate: '2027-06-10', roomId: roomA1 }).expect(400);
  });

  it('404 for a room that does not exist, is malformed, or belongs to another hotel', async () => {
    await addRange(hotelA, String(new Types.ObjectId()), modA, { startDate: '2028-01-01', endDate: '2028-01-05' }).expect(404);
    await addRange(hotelA, 'not-an-id', modA, { startDate: '2028-01-01', endDate: '2028-01-05' }).expect(404);
    // roomB1 exists, but not in moderator A's hotel
    await addRange(hotelA, roomB1, modA, { startDate: '2028-01-01', endDate: '2028-01-05' }).expect(404);
    const stored = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(roomB1) });
    expect(stored?.availability).toHaveLength(1);
  });

  it("403 when the path hotel is another moderator's hotel, unknown, or malformed", async () => {
    await addRange(hotelB, roomB1, modA, { startDate: '2028-01-01', endDate: '2028-01-05' }).expect(403);
    await addRange(String(new Types.ObjectId()), roomA1, modA, { startDate: '2028-01-01', endDate: '2028-01-05' }).expect(403);
    await addRange('not-an-id', roomA1, modA, { startDate: '2028-01-01', endDate: '2028-01-05' }).expect(403);
  });

  it('401 without login; 403 for a user and for an admin', async () => {
    await http().post(`/api/hotels/${hotelA}/rooms/${roomA1}/availability`).send({ startDate: '2028-01-01', endDate: '2028-01-05' }).expect(401);
    await addRange(hotelA, roomA1, userCookie, { startDate: '2028-01-01', endDate: '2028-01-05' }).expect(403);
    await addRange(hotelA, roomA1, admin, { startDate: '2028-01-01', endDate: '2028-01-05' }).expect(403);
  });

  it('concurrent overlapping ranges: exactly one wins', async () => {
    const room = await addRoom(hotelA, modA, 'Race');
    const codes = (
      await Promise.all(
        Array.from({ length: 6 }, (_, i) => addRange(hotelA, room, modA, { startDate: `2029-03-0${i + 1}`, endDate: '2029-03-20' })),
      )
    ).map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    const stored = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(room) });
    expect(stored?.availability).toHaveLength(1);
  });

  it('concurrent non-overlapping ranges all succeed', async () => {
    const room = await addRoom(hotelA, modA, 'Parallel');
    const codes = (
      await Promise.all(
        Array.from({ length: 6 }, (_, i) => addRange(hotelA, room, modA, { startDate: `2030-01-${10 + i * 2}`, endDate: `2030-01-${11 + i * 2}` })),
      )
    ).map((r) => r.status);
    expect(codes).toEqual(Array(6).fill(201));
  });

  it('409 once a room has the maximum number of ranges', async () => {
    const room = await addRoom(hotelA, modA, 'Full');
    const ranges = Array.from({ length: ROOM_MAX_AVAILABILITY_RANGES }, (_, i) => {
      const day = new Date(Date.UTC(2031, 0, 1 + i * 2));
      const next = new Date(Date.UTC(2031, 0, 2 + i * 2));
      return { _id: new Types.ObjectId(), startDate: day.toISOString().slice(0, 10), endDate: next.toISOString().slice(0, 10) };
    });
    await connection.collection('rooms').updateOne({ _id: new Types.ObjectId(room) }, { $set: { availability: ranges } });
    const res = await addRange(hotelA, room, modA, { startDate: '2040-01-01', endDate: '2040-01-05' }).expect(409);
    expect(res.body.message).toMatch(/at most/);
  });
});
