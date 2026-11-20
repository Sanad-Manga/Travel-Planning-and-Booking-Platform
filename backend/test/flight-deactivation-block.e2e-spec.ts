import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { BookingStatus, BookingType } from '../src/common';
import { setupApp } from '../src/setup-app';
import { UpcomingBookingsRegistry } from '../src/users/upcoming-bookings';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

jest.setTimeout(180000);

const PASSWORD = 'Passw0rdOK';
const HOUR = 3_600_000;
const valueOf = (cookie: string): string => cookie.split(';')[0].split('=')[1];

// ACC-12 follow-up (#153): the REAL flight and hotel checkers (no test double) through DELETE /api/users/me.
describe('DELETE /api/users/me is blocked by upcoming flight and hotel bookings (ACC-12, e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let connection: Connection;
  let n = 0;

  const http = () => request(app.getHttpServer());
  const statusOf = async (id: string) => (await connection.collection('users').findOne({ _id: new Types.ObjectId(id) }))?.status;

  async function signup() {
    const email = `acc12flight-${++n}@example.com`;
    await http().post('/api/auth/register').send({ name: `Ali ${n}`, email, password: PASSWORD, acceptTerms: true }).expect(201);
    const res = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('access_token=')) as string;
    return { id: res.body.id as string, email, cookie: `access_token=${valueOf(cookie)}` };
  }
  async function flight(hoursFromNow: number): Promise<Types.ObjectId> {
    const _id = new Types.ObjectId();
    await connection.collection('flights').insertOne({
      _id,
      airlineId: new Types.ObjectId(),
      flightNumber: `T${_id.toHexString().slice(-6)}`,
      departureLocalDate: '2026-12-01',
      departureAt: new Date(Date.now() + hoursFromNow * HOUR),
      status: 'SCHEDULED',
    });
    return _id;
  }
  async function flightBooking(userId: string, flightIds: Types.ObjectId[], status = BookingStatus.CONFIRMED): Promise<Types.ObjectId> {
    const _id = new Types.ObjectId();
    await connection.collection('flightBookings').insertOne({
      _id,
      userId: new Types.ObjectId(userId),
      airlineId: new Types.ObjectId(),
      flightId: flightIds[0],
      segments: flightIds.map((flightId) => ({ flightId })),
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return _id;
  }
  async function hotelBooking(userId: string): Promise<void> {
    const day = (offset: number) => new Date(Date.now() + offset * 24 * HOUR).toISOString().slice(0, 10);
    const _id = new Types.ObjectId();
    await connection.collection('hotelBookings').insertOne({
      _id,
      userId: new Types.ObjectId(userId),
      hotelId: new Types.ObjectId(),
      checkIn: day(10),
      checkOut: day(12),
      status: BookingStatus.CONFIRMED,
      bookingReference: `HTL-${_id.toHexString().slice(-8).toUpperCase()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  const deactivate = (cookie: string) => http().delete('/api/users/me').set('Cookie', cookie).send({ confirm: true });
  const blocked = async (me: { id: string; email: string; cookie: string }) => {
    const res = await deactivate(me.cookie).expect(409);
    expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict', path: '/api/users/me' });
    expect(res.body.message).toBe('You have upcoming confirmed bookings. Cancel them or wait until they are over, then deactivate your account.');
    expect(JSON.stringify(res.body)).not.toContain(me.id);
    expect(await statusOf(me.id)).toBe('ACTIVE');
    await http().post('/api/auth/login').send({ email: me.email, password: PASSWORD }).expect(200); // can still log in
  };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    await connection.model('User').init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('both real checkers are registered', () => {
    expect(app.get(UpcomingBookingsRegistry).registeredTypes().sort()).toEqual([BookingType.FLIGHT, BookingType.HOTEL]);
  });

  it('an upcoming confirmed flight booking blocks with 409 (user stays ACTIVE, can log in); once it is cancelled the same call succeeds', async () => {
    const me = await signup();
    const id = await flightBooking(me.id, [await flight(48)]);
    await blocked(me);
    await connection.collection('flightBookings').updateOne({ _id: id }, { $set: { status: BookingStatus.CANCELLED } });
    await deactivate(me.cookie).expect(200);
    expect(await statusOf(me.id)).toBe('DEACTIVATED');
  });

  it('once the flight has departed the same call succeeds', async () => {
    const me = await signup();
    const flightId = await flight(48);
    await flightBooking(me.id, [flightId]);
    await blocked(me);
    await connection.collection('flights').updateOne({ _id: flightId }, { $set: { departureAt: new Date(Date.now() - HOUR) } });
    await deactivate(me.cookie).expect(200);
    expect(await statusOf(me.id)).toBe('DEACTIVATED');
  });

  it('a round trip with only the return leg ahead still blocks', async () => {
    const me = await signup();
    await flightBooking(me.id, [await flight(-72), await flight(72)]);
    await blocked(me);
  });

  it('a user with only a hotel booking is blocked', async () => {
    const me = await signup();
    await hotelBooking(me.id);
    await blocked(me);
  });

  it('pending and past flight bookings, or another user upcoming booking, do not block; a user without bookings is not affected', async () => {
    const pending = await signup();
    await flightBooking(pending.id, [await flight(48)], BookingStatus.PENDING_PAYMENT);
    const past = await signup();
    await flightBooking(past.id, [await flight(-48)]);
    const neighbour = await signup();
    await flightBooking(neighbour.id, [await flight(48)]);
    const nobody = await signup();
    for (const me of [pending, past, nobody]) {
      await deactivate(me.cookie).expect(200);
      expect(await statusOf(me.id)).toBe('DEACTIVATED');
    }
    expect(await statusOf(neighbour.id)).toBe('ACTIVE');
  });
});
