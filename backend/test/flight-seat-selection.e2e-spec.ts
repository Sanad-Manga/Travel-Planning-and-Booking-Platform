import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { BookingStatus, Role } from '../src/common';
import { setupApp, setupSwagger } from '../src/setup-app';
import {
  TEST_ACCESS_SECRET,
  TEST_REFRESH_SECRET,
} from './helpers/auth-test-app';

/** FLT-28: a traveler chooses a seat on their confirmed booking. */
describe('Flight seat selection (FLT-28) over HTTP (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Connection;
  const http = () => request(app.getHttpServer());
  const now = new Date();

  const airlineId = new Types.ObjectId();
  const flightId = new Types.ObjectId();
  const returnFlightId = new Types.ObjectId();
  let userA: string, userB: string, moderator: string;
  let idA: Types.ObjectId, idB: Types.ObjectId;

  const token = (sub: Types.ObjectId, role: Role) =>
    `access_token=${new JwtService().sign(
      { sub: sub.toString(), role, tokenVersion: 0 },
      { secret: TEST_ACCESS_SECRET, expiresIn: '1h' },
    )}`;

  async function user(name: string, role: Role) {
    const id = new Types.ObjectId();
    await db.collection('users').insertOne({
      _id: id,
      name,
      email: `${name}@example.test`,
      passwordHash: 'synthetic-not-for-login',
      role,
      status: 'ACTIVE',
      consentAcceptedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async function flight(id: Types.ObjectId, number: string, departureAt: Date) {
    await db.collection('flights').insertOne({
      _id: id,
      airlineId,
      flightNumber: number,
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 3_600_000 * 10),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/New_York',
      departureLocalDate: departureAt.toISOString().slice(0, 10),
      status: 'SCHEDULED',
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('cabins').insertOne({
      flightId: id,
      cabinClass: 'ECONOMY',
      totalSeats: 60, // seats 1A-10F
      bookedSeats: 0,
      heldSeats: 0,
      priceCents: 10000,
      freeBags: 1,
      maxBagWeightKg: 23,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function booking(
    userId: Types.ObjectId,
    extra: Record<string, unknown> = {},
    passengerTypes = ['ADULT', 'ADULT', 'INFANT'],
    flightIds = [flightId],
  ) {
    const segments = flightIds.map((f) => ({
      flightId: f,
      airlineId,
      cabinClass: 'ECONOMY',
      seats: 2,
      farePerPassengerCents: 10000,
      infantFareCents: 1000,
      baggageFeeCents: 0,
    }));
    const res = await db.collection('flightBookings').insertOne({
      userId,
      airlineId,
      flightId: flightIds[0],
      ...(flightIds.length > 1 ? { segments } : {}),
      cabinClass: 'ECONOMY',
      passengerCounts: { adults: 2, children: 0, infants: 1 },
      passengers: passengerTypes.map((type, i) => ({
        fullName: `Passenger ${i}`,
        dateOfBirth: '1990-01-01',
        passportOrIdNumber: `P${i}`,
        passengerType: type,
        extraBags: [],
        baggageFeeCents: 0,
      })),
      seats: 2,
      farePerPassengerCents: 10000,
      infantFareCents: 1000,
      totalCents: 21000,
      baggageFeeCents: 0,
      currency: 'USD',
      status: BookingStatus.CONFIRMED,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    return res.insertedId.toString();
  }

  const pick = (id: string, body: Record<string, unknown>, cookie = userA) =>
    http()
      .patch(`/api/flight-bookings/${id}/seat`)
      .set('Cookie', cookie)
      .send(body);
  const stored = async (id: string) =>
    (
      await db
        .collection('flightBookings')
        .findOne({ _id: new Types.ObjectId(id) })
    )?.seatSelections;
  const claims = (seat?: string) =>
    db
      .collection('flightSeatClaims')
      .countDocuments(seat ? { seat, flightId } : { flightId });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_ACCESS_SECRET = TEST_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_REFRESH_SECRET;
    process.env.COOKIE_SECURE = 'false';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    setupSwagger(app);
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    await db.model('FlightSeatClaim').init(); // the unique index must exist before the parallel test

    await flight(flightId, 'MS700', new Date(Date.now() + 40 * 86_400_000));
    await flight(
      returnFlightId,
      'MS701',
      new Date(Date.now() + 50 * 86_400_000),
    );
    idA = await user('seat-a', Role.USER);
    idB = await user('seat-b', Role.USER);
    userA = token(idA, Role.USER);
    userB = token(idB, Role.USER);
    moderator = token(
      await user('seat-mod', Role.AIRLINE_MODERATOR),
      Role.AIRLINE_MODERATOR,
    );
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('the owner takes a free seat of the booked cabin; it is stored on the booking and answered back', async () => {
    const id = await booking(idA);
    const res = await pick(id, { seat: '1A' }).expect(200);
    expect(res.body).toEqual({
      bookingId: id,
      seatSelections: [
        { flightId: flightId.toString(), passengerIndex: 0, seat: '1A' },
      ],
    });
    expect(await stored(id)).toHaveLength(1);
    expect(await claims('1A')).toBe(1);
  });

  it('accepts lower case and picks the passenger; the same seat again is a harmless repeat', async () => {
    const id = await booking(idA);
    await pick(id, { seat: '1b', passengerIndex: 1 }).expect(200);
    const again = await pick(id, { seat: '1B', passengerIndex: 1 }).expect(200);
    expect(again.body.seatSelections).toEqual([
      { flightId: flightId.toString(), passengerIndex: 1, seat: '1B' },
    ]);
    expect(await claims('1B')).toBe(1);
  });

  it('a seat that exists nowhere or only beyond the cabin size is a 400 with a seat detail', async () => {
    const id = await booking(idA);
    for (const seat of ['11A', '1G', '0A', 'A1', '12', '']) {
      const res = await pick(id, { seat }).expect(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'seat' })]),
      );
    }
    await pick(id, {}).expect(400);
    await pick(id, { seat: '10F' }).expect(200); // the last seat of a 60-seat cabin exists
    await pick(id, { seat: '1A', extra: true }).expect(400);
  });

  it('a seat already taken by another booking is 409, and nothing changes for the loser', async () => {
    const first = await booking(idA);
    const second = await booking(idB);
    await pick(first, { seat: '1C' }).expect(200);
    const res = await pick(second, { seat: '1C' }, userB).expect(409);
    expect(res.body.message).toMatch(/already taken/);
    expect(await stored(second)).toBeUndefined();
    await pick(second, { seat: '1D' }, userB).expect(200);
  });

  it('two travelers asking for the same seat at the same moment: exactly one 200 and one 409', async () => {
    const first = await booking(idA);
    const second = await booking(idB);
    const results = await Promise.all([
      pick(first, { seat: '2A' }, userA),
      pick(second, { seat: '2A' }, userB),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await claims('2A')).toBe(1);
    const holders = (await Promise.all([stored(first), stored(second)])).filter(
      Boolean,
    );
    expect(holders).toHaveLength(1);
  });

  it('many parallel requests for one seat: one winner only', async () => {
    const ids: string[] = [];
    const owners: string[] = [];
    for (let i = 0; i < 6; i++) {
      const owner = await user(`seat-par-${i}`, Role.USER);
      ids.push(await booking(owner));
      owners.push(token(owner, Role.USER));
    }
    const results = await Promise.all(
      ids.map((id, i) => pick(id, { seat: '2B' }, owners[i])),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await claims('2B')).toBe(1);
  });

  it('changing seat moves the passenger: the new seat is taken, the old one is free for others', async () => {
    const mine = await booking(idA);
    const other = await booking(idB);
    await pick(mine, { seat: '1E' }).expect(200);
    const moved = await pick(mine, { seat: '1F' }).expect(200);
    expect(moved.body.seatSelections).toEqual([
      { flightId: flightId.toString(), passengerIndex: 0, seat: '1F' },
    ]);
    expect(await claims('1E')).toBe(0);
    await pick(other, { seat: '1E' }, userB).expect(200);
  });

  it('two passengers of one booking cannot share a seat', async () => {
    const id = await booking(idA);
    await pick(id, { seat: '3A', passengerIndex: 0 }).expect(200);
    await pick(id, { seat: '3A', passengerIndex: 1 }).expect(409);
    expect(await stored(id)).toHaveLength(1);
  });

  it('only the owner: another traveler and an unknown or malformed id are 404, guest 401, other roles 403', async () => {
    const id = await booking(idA);
    await pick(id, { seat: '1A' }, userB).expect(404);
    await pick(new Types.ObjectId().toString(), { seat: '1A' }).expect(404);
    await pick('not-an-id', { seat: '1A' }).expect(404);
    await http()
      .patch(`/api/flight-bookings/${id}/seat`)
      .send({ seat: '1A' })
      .expect(401);
    await pick(id, { seat: '1A' }, moderator).expect(403);
    expect(await stored(id)).toBeUndefined();
  });

  it('only a confirmed booking: pending, cancelled and expired are 409', async () => {
    for (const status of [
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
    ]) {
      const id = await booking(idA, { status });
      await pick(id, { seat: '1A' }).expect(409);
    }
  });

  it('an infant takes no seat, an unknown passenger and an unknown flight are 400', async () => {
    const id = await booking(idA);
    const infant = await pick(id, { seat: '1A', passengerIndex: 2 }).expect(
      400,
    );
    expect(infant.body.details[0].field).toBe('passengerIndex');
    await pick(id, { seat: '1A', passengerIndex: 3 }).expect(400);
    await pick(id, {
      seat: '1A',
      flightId: new Types.ObjectId().toString(),
    }).expect(400);
    await pick(id, { seat: '1A', flightId: 'nope' }).expect(400);
  });

  it('a booking without passenger details (legacy hold) is 409', async () => {
    const id = await booking(idA);
    await db
      .collection('flightBookings')
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $unset: { passengers: '' } },
      );
    await pick(id, { seat: '1A' }).expect(409);
  });

  it('a flight that has left or was cancelled no longer takes seats', async () => {
    const gone = new Types.ObjectId();
    await flight(gone, 'MS999', new Date(Date.now() - 86_400_000));
    const old = await booking(idA, {}, ['ADULT'], [gone]);
    await pick(old, { seat: '1A' }).expect(409);

    const cancelled = new Types.ObjectId();
    await flight(cancelled, 'MS998', new Date(Date.now() + 86_400_000));
    await db
      .collection('flights')
      .updateOne({ _id: cancelled }, { $set: { status: 'CANCELLED' } });
    const id = await booking(idA, {}, ['ADULT'], [cancelled]);
    await pick(id, { seat: '1A' }).expect(409);
  });

  it('a round trip chooses seats per flight; the same label on the other flight is a different seat', async () => {
    const id = await booking(
      idA,
      {},
      ['ADULT', 'ADULT'],
      [flightId, returnFlightId],
    );
    await pick(id, { seat: '4A' }).expect(200);
    const res = await pick(id, {
      seat: '4A',
      flightId: returnFlightId.toString(),
    }).expect(200);
    expect(res.body.seatSelections).toHaveLength(2);
  });

  it('seats of a cancelled booking are free again, with no cleanup needed', async () => {
    const mine = await booking(idA);
    const other = await booking(idB);
    await pick(mine, { seat: '5A' }).expect(200);
    await pick(other, { seat: '5A' }, userB).expect(409);
    await db
      .collection('flightBookings')
      .updateOne(
        { _id: new Types.ObjectId(mine) },
        { $set: { status: BookingStatus.CANCELLED } },
      );
    await pick(other, { seat: '5A' }, userB).expect(200);
    const claim = await db
      .collection('flightSeatClaims')
      .findOne({ flightId, seat: '5A' });
    expect(claim!.bookingId.toString()).toBe(other);
    expect(await claims('5A')).toBe(1);
  });

  describe('seat map and summary (follow-up)', () => {
    const map = (id: string, cookie = userA, qs = '') =>
      http()
        .get(`/api/flight-bookings/${id}/seat-map${qs}`)
        .set('Cookie', cookie);

    it('shows every seat of the cabin as FREE, TAKEN or YOURS, and reveals nobody', async () => {
      const mine = await booking(idA);
      const other = await booking(idB);
      await pick(mine, { seat: '6A' }).expect(200);
      await pick(other, { seat: '6B' }, userB).expect(200);
      const res = await map(mine).expect(200);
      expect(res.body).toMatchObject({
        bookingId: mine,
        flightId: flightId.toString(),
        cabinClass: 'ECONOMY',
      });
      expect(res.body.seats).toHaveLength(60);
      expect(res.body.seats[0]).toEqual({
        seat: '1A',
        status: expect.any(String),
      });
      const at = (seat: string) =>
        res.body.seats.find((x: { seat: string }) => x.seat === seat).status;
      expect(at('6A')).toBe('YOURS');
      expect(at('6B')).toBe('TAKEN');
      expect(at('6C')).toBe('FREE');
      for (const entry of res.body.seats) {
        expect(Object.keys(entry).sort()).toEqual(['seat', 'status']);
      }
    });

    it('a cancelled booking frees its seats on the map', async () => {
      const gone = await booking(idB);
      const mine = await booking(idA);
      await pick(gone, { seat: '7A' }, userB).expect(200);
      await db
        .collection('flightBookings')
        .updateOne(
          { _id: new Types.ObjectId(gone) },
          { $set: { status: BookingStatus.CANCELLED } },
        );
      const res = await map(mine).expect(200);
      expect(
        res.body.seats.find((x: { seat: string }) => x.seat === '7A').status,
      ).toBe('FREE');
    });

    it('a round trip shows the chosen leg', async () => {
      const id = await booking(
        idA,
        {},
        ['ADULT', 'ADULT'],
        [flightId, returnFlightId],
      );
      await pick(id, {
        seat: '8A',
        flightId: returnFlightId.toString(),
      }).expect(200);
      const back = await map(id, userA, `?flightId=${returnFlightId}`).expect(
        200,
      );
      expect(back.body.flightId).toBe(returnFlightId.toString());
      expect(
        back.body.seats.find((x: { seat: string }) => x.seat === '8A').status,
      ).toBe('YOURS');
      const out = await map(id).expect(200);
      expect(
        out.body.seats.find((x: { seat: string }) => x.seat === '8A').status,
      ).toBe('FREE');
      await map(id, userA, `?flightId=${new Types.ObjectId()}`).expect(400);
      await map(id, userA, '?flightId=nope').expect(400);
    });

    it('owner only and confirmed only: other traveler 404, guest 401, moderator 403, pending 409', async () => {
      const id = await booking(idA);
      await map(id, userB).expect(404);
      await http().get(`/api/flight-bookings/${id}/seat-map`).expect(401);
      await map(id, moderator).expect(403);
      await map('not-an-id').expect(404);
      const pending = await booking(idA, {
        status: BookingStatus.PENDING_PAYMENT,
      });
      await map(pending).expect(409);
    });

    it('the chosen seats appear on the booking summary', async () => {
      const id = await booking(idA, {
        bookingReference: `FLT-${new Types.ObjectId()}`,
      });
      const before = await http()
        .get(`/api/flight-bookings/${id}`)
        .set('Cookie', userA);
      if (before.status === 200)
        expect(before.body.seatSelections).toBeUndefined();
      await pick(id, { seat: '9A' }).expect(200);
      const after = await http()
        .get(`/api/flight-bookings/${id}`)
        .set('Cookie', userA)
        .expect(200);
      expect(after.body.seatSelections).toEqual([
        { flightId: flightId.toString(), passengerIndex: 0, seat: '9A' },
      ]);
    });
  });

  it('is documented in Swagger', async () => {
    const docs = await http().get('/api/docs-json').expect(200);
    const op = docs.body.paths['/api/flight-bookings/{id}/seat']?.patch;
    expect(op).toBeDefined();
    expect(Object.keys(op.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );
    expect(
      docs.body.paths['/api/flight-bookings/{id}/seat-map']?.get,
    ).toBeDefined();
  });
});
