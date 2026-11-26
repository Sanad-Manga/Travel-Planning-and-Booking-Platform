import { ForbiddenException } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, FlightStatus, Role } from '../common';
import { MyFlightsService } from './my-flights.service';
import { Flight, FlightSchema } from './schemas/flight.schema';

jest.setTimeout(60000);

const NOW = new Date('2026-12-01T12:00:00.000Z');
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe('MyFlightsService (FLT-29, M2-10) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let flights: Model<Flight>;
  let service: MyFlightsService;
  const mine = new Types.ObjectId();
  const other = new Types.ObjectId();
  const moderator = (airlineId?: Types.ObjectId): AuthenticatedUser =>
    ({
      userId: new Types.ObjectId().toString(),
      role: Role.AIRLINE_MODERATOR,
      airlineId: airlineId?.toString(),
    }) as AuthenticatedUser;

  const insert = (
    airlineId: Types.ObjectId,
    number: string,
    status: FlightStatus,
    departureAt: Date,
  ) =>
    flights.collection.insertOne({
      airlineId,
      flightNumber: number,
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 3_600_000),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/New_York',
      departureLocalDate: departureAt.toISOString().slice(0, 10),
      status,
      createdAt: NOW,
      updatedAt: NOW,
    });

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'flt29_mine_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(server.getUri()),
        MongooseModule.forFeature([
          { name: Flight.name, schema: FlightSchema },
        ]),
      ],
      providers: [MyFlightsService],
    }).compile();
    await moduleRef.init();
    flights = moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    service = moduleRef.get(MyFlightsService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await server.stop();
  });

  beforeEach(async () => {
    await flights.deleteMany({});
    await insert(mine, 'MS1', FlightStatus.SCHEDULED, hoursFromNow(48));
    await insert(mine, 'MS2', FlightStatus.SCHEDULED, hoursFromNow(-5));
    await insert(mine, 'MS3', FlightStatus.CANCELLED, hoursFromNow(72));
    await insert(mine, 'MS4', FlightStatus.DEPARTED, hoursFromNow(-30));
    await insert(other, 'XX9', FlightStatus.SCHEDULED, hoursFromNow(10));
  });

  it('lists only my airline flights, latest departure first, any status', async () => {
    const page = await service.list(moderator(mine), {}, NOW);
    expect(page.items.map((f) => f.flightNumber)).toEqual([
      'MS3',
      'MS1',
      'MS2',
      'MS4',
    ]);
    expect(page.total).toBe(4);
  });

  it('reports a past SCHEDULED flight as DEPARTED', async () => {
    const page = await service.list(moderator(mine), {}, NOW);
    expect(page.items.find((f) => f.flightNumber === 'MS2')?.status).toBe(
      FlightStatus.DEPARTED,
    );
  });

  it('filters by status, treating past SCHEDULED flights as DEPARTED', async () => {
    const scheduled = await service.list(
      moderator(mine),
      { status: FlightStatus.SCHEDULED },
      NOW,
    );
    expect(scheduled.items.map((f) => f.flightNumber)).toEqual(['MS1']);
    const departed = await service.list(
      moderator(mine),
      { status: FlightStatus.DEPARTED },
      NOW,
    );
    expect(departed.items.map((f) => f.flightNumber)).toEqual(['MS2', 'MS4']);
  });

  it('paginates', async () => {
    const page = await service.list(moderator(mine), { page: 2, limit: 3 }, NOW);
    expect(page.items.map((f) => f.flightNumber)).toEqual(['MS4']);
    expect(page.total).toBe(4);
  });

  it('refuses a user without an airline', async () => {
    await expect(service.list(moderator(), {}, NOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
