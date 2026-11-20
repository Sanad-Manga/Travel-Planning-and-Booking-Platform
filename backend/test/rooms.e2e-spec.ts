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
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

describe('HTL-03 add rooms (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const PASSWORD = 'Passw0rdOK';
  const http = () => request(app.getHttpServer());
  const validRoom = (over: Record<string, unknown> = {}) => ({
    name: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    pricePerNightCents: 8500,
    ...over,
  });

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

  const addRoom = (hotelId: string, cookie: string, body: Record<string, unknown>) =>
    http().post(`/api/hotels/${hotelId}/rooms`).set('Cookie', cookie).send(body);

  let admin: string;
  let userCookie: string;
  let modA: string;
  let modB: string;
  let hotelA: string;
  let hotelB: string;

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
    await connection.model('Room').init(); // build the unique index before the tests run

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
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  it('moderator adds a room to their own hotel; price is integer cents, currency is returned', async () => {
    const res = await addRoom(hotelA, modA, validRoom()).expect(201);
    expect(res.body).toMatchObject({
      hotelId: hotelA,
      name: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNightCents: 8500,
      currency: 'USD',
      isActive: true,
    });
    expect(typeof res.body.id).toBe('string');
    expect(res.body._id).toBeUndefined();
    expect(res.body.nameKey).toBeUndefined();

    const stored = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(res.body.id) });
    expect(stored?.pricePerNightCents).toBe(8500);
    expect(Number.isInteger(stored?.pricePerNightCents)).toBe(true);
  });

  it('trims text fields', async () => {
    const res = await addRoom(hotelA, modA, validRoom({ name: '  Sea View  ', type: ' Suite ' })).expect(201);
    expect(res.body).toMatchObject({ name: 'Sea View', type: 'Suite' });
  });

  it('409 for a duplicate room number in the same hotel (case-insensitive), 201 in another hotel', async () => {
    await addRoom(hotelA, modA, validRoom({ name: 'Suite A' })).expect(201);
    await addRoom(hotelA, modA, validRoom({ name: 'Suite A' })).expect(409);
    const res = await addRoom(hotelA, modA, validRoom({ name: 'SUITE a' })).expect(409);
    expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
    await addRoom(hotelB, modB, validRoom({ name: 'Suite A' })).expect(201);
  });

  it('400 with the error shape for maxOccupancy < 1', async () => {
    for (const maxOccupancy of [0, -2]) {
      const res = await addRoom(hotelA, modA, validRoom({ name: 'Occ', maxOccupancy })).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed', path: `/api/hotels/${hotelA}/rooms` });
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain('maxOccupancy');
    }
  });

  it('400 for price <= 0, fractional price, string price, and a price sent as a float', async () => {
    for (const pricePerNightCents of [0, -100, 85.5, '8500', null]) {
      const res = await addRoom(hotelA, modA, validRoom({ name: 'Price', pricePerNightCents })).expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain('pricePerNightCents');
    }
  });

  it('400 for missing fields, zero beds, blank name and unknown fields (isActive, hotelId)', async () => {
    const res = await addRoom(hotelA, modA, {}).expect(400);
    expect(res.body.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(['name', 'type', 'beds', 'maxOccupancy', 'pricePerNightCents']),
    );
    await addRoom(hotelA, modA, validRoom({ name: 'Beds', beds: 0 })).expect(400);
    await addRoom(hotelA, modA, validRoom({ name: '   ' })).expect(400);
    await addRoom(hotelA, modA, validRoom({ name: 'Extra', isActive: false })).expect(400);
    await addRoom(hotelA, modA, validRoom({ name: 'Extra2', hotelId: hotelB })).expect(400);
  });

  it("403 when adding a room to another moderator's hotel, and nothing is stored", async () => {
    const before = await connection.collection('rooms').countDocuments({ hotelId: new Types.ObjectId(hotelB) });
    await addRoom(hotelB, modA, validRoom({ name: 'Intruder' })).expect(403);
    expect(await connection.collection('rooms').countDocuments({ hotelId: new Types.ObjectId(hotelB) })).toBe(before);
  });

  it('403 for an unknown or malformed hotel id', async () => {
    await addRoom(String(new Types.ObjectId()), modA, validRoom({ name: 'Ghost' })).expect(403);
    await addRoom('not-an-id', modA, validRoom({ name: 'Ghost' })).expect(403);
  });

  it('401 without login; 403 for a user and for an admin', async () => {
    await http().post(`/api/hotels/${hotelA}/rooms`).send(validRoom({ name: 'Anon' })).expect(401);
    await addRoom(hotelA, userCookie, validRoom({ name: 'U' })).expect(403);
    await addRoom(hotelA, admin, validRoom({ name: 'Adm' })).expect(403);
  });

  it('concurrent adds of the same room number: exactly one wins', async () => {
    const codes = (await Promise.all(Array.from({ length: 5 }, () => addRoom(hotelA, modA, validRoom({ name: 'Race' }))))).map(
      (r) => r.status,
    );
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(4);
  });
});
