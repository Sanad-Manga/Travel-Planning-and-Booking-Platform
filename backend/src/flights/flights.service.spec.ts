import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { Airline } from '../airlines';
import { AuthenticatedUser, Role } from '../common';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightsModule } from './flights.module';
import { FlightsService } from './flights.service';
import { Flight } from './schemas/flight.schema';

jest.setTimeout(60000);

const NOW = new Date('2026-11-05T10:00:00.000Z');

describe('FlightsService.create (FLT-03) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let connection: Connection;
  let flights: Model<Flight>;
  let airlines: Model<Airline>;
  let service: FlightsService;
  let airlineA: Types.ObjectId;
  let airlineB: Types.ObjectId;
  let moderatorA: AuthenticatedUser;

  const valid = (): CreateFlightDto => ({
    flightNumber: 'MS777',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureLocalTime: '2026-12-01T14:30',
    arrivalLocalTime: '2026-12-01T19:45',
  });

  const moderatorOf = (airlineId: Types.ObjectId): AuthenticatedUser => ({
    userId: new Types.ObjectId().toString(),
    role: Role.AIRLINE_MODERATOR,
    airlineId: airlineId.toString(),
  });

  /** Runs create() and returns the thrown error's response body (or fails the test). */
  async function failure(
    user: AuthenticatedUser,
    dto: CreateFlightDto,
  ): Promise<{ status: number; body: { details?: { field: string }[] } }> {
    try {
      await service.create(user, dto, NOW);
    } catch (error) {
      const e = error as {
        getStatus: () => number;
        getResponse: () => { details?: { field: string }[] };
      };
      return { status: e.getStatus(), body: e.getResponse() };
    }
    throw new Error('expected create() to throw');
  }

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'flt03_flights_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), FlightsModule],
    }).compile();
    await moduleRef.init();
    connection = moduleRef.get<Connection>(getConnectionToken());
    flights = moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    airlines = moduleRef.get<Model<Airline>>(getModelToken(Airline.name));
    service = moduleRef.get(FlightsService);
    await flights.init(); // build the unique index before the tests rely on it

    // The seeded airports (FLT-02) are owned by reference-data; tests insert the few they need.
    const airports = connection.collection('airports');
    await airports.insertMany([
      {
        iata_code: 'CAI',
        name: 'Cairo',
        city_id: 'c1',
        country_code: 'EG',
        time_zone: 'Africa/Cairo',
      },
      {
        iata_code: 'JFK',
        name: 'John F. Kennedy',
        city_id: 'c2',
        country_code: 'US',
        time_zone: 'America/New_York',
      },
      {
        iata_code: 'LHR',
        name: 'Heathrow',
        city_id: 'c3',
        country_code: 'GB',
        time_zone: 'Europe/London',
      },
    ]);
  });

  beforeEach(async () => {
    await flights.deleteMany({});
    await airlines.deleteMany({});
    airlineA = (await airlines.create({ name: 'Airline A', code: 'AA' }))._id;
    airlineB = (await airlines.create({ name: 'Airline B', code: 'BB' }))._id;
    moderatorA = moderatorOf(airlineA);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  it("converts each airport's local time to UTC and stores the zones", async () => {
    const flight = await service.create(moderatorA, valid(), NOW);
    expect(flight).toMatchObject({
      airlineId: airlineA.toString(),
      flightNumber: 'MS777',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: '2026-12-01T12:30:00.000Z', // Cairo is UTC+2
      arrivalAt: '2026-12-02T00:45:00.000Z', // New York is UTC-5
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/New_York',
      status: 'SCHEDULED',
    });
    expect(flight.id).toMatch(/^[0-9a-f]{24}$/);
    expect(Object.keys(flight)).not.toEqual(
      expect.arrayContaining(['_id', '__v']),
    );
    const stored = await flights.findById(flight.id).lean();
    expect(stored!.departureAt.toISOString()).toBe('2026-12-01T12:30:00.000Z');
    expect(stored!.departureLocalDate).toBe('2026-12-01');
  });

  it('is correct across a second pair of zones (London to Cairo)', async () => {
    const flight = await service.create(
      moderatorA,
      {
        ...valid(),
        flightNumber: 'MS100',
        departureAirport: 'LHR',
        arrivalAirport: 'CAI',
        departureLocalTime: '2027-07-01T09:00', // BST, UTC+1
        arrivalLocalTime: '2027-07-01T15:30', // Cairo summer time, UTC+3
      },
      NOW,
    );
    expect(flight.departureAt).toBe('2027-07-01T08:00:00.000Z');
    expect(flight.arrivalAt).toBe('2027-07-01T12:30:00.000Z');
  });

  it('uses the airline of the login, whatever else is in play', async () => {
    const flight = await service.create(moderatorOf(airlineB), valid(), NOW);
    expect(flight.airlineId).toBe(airlineB.toString());
  });

  describe('rejections (field-level 400)', () => {
    it('identical departure and arrival airports', async () => {
      const { status, body } = await failure(moderatorA, {
        ...valid(),
        arrivalAirport: 'CAI',
        arrivalLocalTime: '2026-12-01T19:45',
      });
      expect(status).toBe(400);
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'arrivalAirport' }),
        ]),
      );
    });

    it('arrival not after departure, compared in UTC (not as local text)', async () => {
      // 14:30 Cairo = 12:30Z. 08:00 in New York = 13:00Z is AFTER it, even though "08:00" < "14:30" as text.
      const ok = await service.create(
        moderatorA,
        { ...valid(), arrivalLocalTime: '2026-12-01T08:00' },
        NOW,
      );
      expect(ok.arrivalAt).toBe('2026-12-01T13:00:00.000Z');

      // 07:00 in New York = 12:00Z is BEFORE 12:30Z, so it is rejected although the text 07:00 vs 14:30 hides it.
      const { status, body } = await failure(moderatorA, {
        ...valid(),
        flightNumber: 'MS778',
        arrivalLocalTime: '2026-12-01T07:00',
      });
      expect(status).toBe(400);
      expect(body.details).toEqual([
        expect.objectContaining({ field: 'arrivalLocalTime' }),
      ]);
    });

    it('arrival equal to departure', async () => {
      const { status, body } = await failure(moderatorA, {
        ...valid(),
        departureAirport: 'LHR',
        arrivalAirport: 'CAI',
        departureLocalTime: '2026-12-01T10:00', // 10:00Z
        arrivalLocalTime: '2026-12-01T12:00', // 10:00Z
      });
      expect(status).toBe(400);
      expect(body.details?.map((d) => d.field)).toContain('arrivalLocalTime');
    });

    it('departure in the past (UTC compared with the clock)', async () => {
      const { status, body } = await failure(moderatorA, {
        ...valid(),
        departureLocalTime: '2026-11-05T11:30', // Cairo 09:30Z, before NOW 10:00Z
        arrivalLocalTime: '2026-11-05T20:00',
      });
      expect(status).toBe(400);
      expect(body.details).toEqual([
        expect.objectContaining({ field: 'departureLocalTime' }),
      ]);
    });

    it('a departure a minute in the future is accepted, the same minute is not', async () => {
      // Cairo is UTC+2, so NOW (10:00Z) is 12:00 local.
      await expect(
        service.create(
          moderatorA,
          {
            ...valid(),
            departureLocalTime: '2026-11-05T12:01',
            arrivalLocalTime: '2026-11-05T20:00',
          },
          NOW,
        ),
      ).resolves.toBeDefined();
      const { status } = await failure(moderatorA, {
        ...valid(),
        flightNumber: 'MS779',
        departureLocalTime: '2026-11-05T12:00',
        arrivalLocalTime: '2026-11-05T20:00',
      });
      expect(status).toBe(400);
    });

    it('airports that are not in the seeded list', async () => {
      const { status, body } = await failure(moderatorA, {
        ...valid(),
        departureAirport: 'ZZZ',
        arrivalAirport: 'YYY',
      });
      expect(status).toBe(400);
      expect(body.details?.map((d) => d.field)).toEqual(
        expect.arrayContaining(['departureAirport', 'arrivalAirport']),
      );
    });

    it('a local time that does not exist (daylight-saving gap)', async () => {
      const { status, body } = await failure(moderatorA, {
        ...valid(),
        departureAirport: 'JFK',
        arrivalAirport: 'LHR',
        departureLocalTime: '2027-03-14T02:30', // US clocks jump 02:00 -> 03:00 on 14 Mar 2027
        arrivalLocalTime: '2027-03-14T20:00',
      });
      expect(status).toBe(400);
      expect(body.details?.map((d) => d.field)).toContain('departureLocalTime');
    });

    it('reports every broken rule at once', async () => {
      const { body } = await failure(moderatorA, {
        ...valid(),
        arrivalAirport: 'CAI',
        departureLocalTime: '2020-01-01T10:00',
        arrivalLocalTime: '2020-01-01T09:00',
      });
      expect(body.details?.map((d) => d.field).sort()).toEqual([
        'arrivalAirport',
        'arrivalLocalTime',
        'departureLocalTime',
      ]);
    });
  });

  describe('duplicates (409)', () => {
    it('same airline, same flight number, same departure date', async () => {
      await service.create(moderatorA, valid(), NOW);
      const { status, body } = await failure(moderatorA, {
        ...valid(),
        departureLocalTime: '2026-12-01T21:00', // later the same local day
        arrivalLocalTime: '2026-12-02T02:00',
      });
      expect(status).toBe(409);
      expect(body.details).toEqual([
        expect.objectContaining({ field: 'flightNumber' }),
      ]);
      expect(await flights.countDocuments()).toBe(1);
    });

    it('allows the same number on another date', async () => {
      await service.create(moderatorA, valid(), NOW);
      await expect(
        service.create(
          moderatorA,
          {
            ...valid(),
            departureLocalTime: '2026-12-02T14:30',
            arrivalLocalTime: '2026-12-02T19:45',
          },
          NOW,
        ),
      ).resolves.toBeDefined();
    });

    it('allows the same number and date for a different airline', async () => {
      await service.create(moderatorA, valid(), NOW);
      await expect(
        service.create(moderatorOf(airlineB), valid(), NOW),
      ).resolves.toBeDefined();
    });

    it('two simultaneous identical requests create exactly one flight', async () => {
      const results = await Promise.allSettled([
        service.create(moderatorA, valid(), NOW),
        service.create(moderatorA, valid(), NOW),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await flights.countDocuments()).toBe(1);
    });
  });

  describe('who may create', () => {
    it.each([Role.USER, Role.ADMIN, Role.HOTEL_MODERATOR])(
      '%s gets 403',
      async (role) => {
        const { status } = await failure(
          {
            userId: new Types.ObjectId().toString(),
            role,
            airlineId: airlineA.toString(),
          },
          valid(),
        );
        expect(status).toBe(403);
      },
    );

    it('a moderator without an airline gets 403', async () => {
      const { status } = await failure(
        {
          userId: new Types.ObjectId().toString(),
          role: Role.AIRLINE_MODERATOR,
        },
        valid(),
      );
      expect(status).toBe(403);
    });

    it('a deactivated airline cannot create flights', async () => {
      await airlines.updateOne({ _id: airlineA }, { isActive: false });
      const { status } = await failure(moderatorA, valid());
      expect(status).toBe(403);
    });

    it('a moderator whose airline no longer exists gets 404', async () => {
      const { status } = await failure(
        moderatorOf(new Types.ObjectId()),
        valid(),
      );
      expect(status).toBe(404);
    });
  });
});
