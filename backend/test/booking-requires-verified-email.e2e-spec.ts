import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { Role } from '../src/common/enums';
import { setupApp } from '../src/setup-app';
import { TEST_ACCESS_SECRET, TEST_REFRESH_SECRET } from './helpers/auth-test-app';

/**
 * ACC-02 acceptance criterion: an unverified user cannot create a booking.
 * Runs against the real AppModule and the real booking-creation routes (not a test controller).
 * The guard runs before body validation, so an empty body is enough to prove the 403.
 */
describe('Booking creation requires a verified email (ACC-02, whole app)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let connection: Connection;

  const http = () => request(app.getHttpServer());
  const jwt = new JwtService({ secret: TEST_ACCESS_SECRET });

  async function cookieFor(email: string, emailVerified?: boolean): Promise<string> {
    const { insertedId } = await connection.collection('users').insertOne({
      name: 'Ali Hassan',
      email,
      passwordHash: hashSync('Passw0rdOK', 4),
      role: Role.USER,
      status: 'ACTIVE',
      ...(emailVerified === undefined ? {} : { emailVerified }),
      consentAcceptedAt: new Date(),
      preferredCurrency: 'USD',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await jwt.signAsync({ sub: insertedId.toHexString(), role: Role.USER }, { expiresIn: '5m' });
    return `access_token=${token}`;
  }

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
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

  const routes = ['/api/flight-bookings', '/api/flight-bookings/hold', '/api/hotel-bookings'];

  describe.each(routes)('POST %s', (path) => {
    it('unverified user (emailVerified=false) gets 403 "Verify your email before booking"', async () => {
      const cookie = await cookieFor(`unverified${path.replace(/\W/g, '')}@example.com`, false);
      const res = await http().post(path).set('Cookie', cookie).send({}).expect(403);
      expect(res.body).toMatchObject({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Verify your email before booking',
        details: [{ field: 'emailVerified', message: 'EMAIL_NOT_VERIFIED' }],
        path,
      });
    });

    it('verified user and field-less (legacy) user pass the guard (validation answers 400, not 403)', async () => {
      const slug = path.replace(/\W/g, '');
      for (const cookie of [await cookieFor(`verified${slug}@example.com`, true), await cookieFor(`legacy${slug}@example.com`)]) {
        const res = await http().post(path).set('Cookie', cookie).send({});
        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(401);
      }
    });

    it('guest still gets 401', async () => {
      await http().post(path).send({}).expect(401);
    });
  });

  it('a round trip (two segments) goes through the same guarded routes', async () => {
    const cookie = await cookieFor('roundtrip@example.com', false);
    const body = { segments: [{ flightId: new Types.ObjectId().toHexString() }, { flightId: new Types.ObjectId().toHexString() }] };
    await http().post('/api/flight-bookings').set('Cookie', cookie).send(body).expect(403);
    await http().post('/api/flight-bookings/hold').set('Cookie', cookie).send(body).expect(403);
  });
});
