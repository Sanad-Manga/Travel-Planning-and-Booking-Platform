import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, CabinClass, FlightStatus, Role } from '../common';
import { FlightCabinsService } from './flight-cabins.service';
import { Cabin, CabinSchema } from './schemas/cabin.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

jest.setTimeout(60000);

describe('FlightCabinsService.list (FLT-04, M2-83) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let flights: Model<Flight>;
  let cabins: Model<Cabin>;
  let service: FlightCabinsService;
  const mine = new Types.ObjectId();
  const other = new Types.ObjectId();
  const flightId = new Types.ObjectId();
  const otherFlightId = new Types.ObjectId();
  const moderator = (airlineId?: Types.ObjectId): AuthenticatedUser =>
    ({
      userId: new Types.ObjectId().toString(),
      role: Role.AIRLINE_MODERATOR,
      airlineId: airlineId?.toString(),
    }) as AuthenticatedUser;

  const insertFlight = (
    _id: Types.ObjectId,
    airlineId: Types.ObjectId,
    status: FlightStatus,
  ) =>
    flights.collection.insertOne({
      _id,
      airlineId,
      flightNumber: 'MS1',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: new Date('2099-12-01T10:00:00Z'),
      arrivalAt: new Date('2099-12-01T20:00:00Z'),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/New_York',
      departureLocalDate: '2099-12-01',
      status,
    });
  const insertCabin = (
    forFlight: Types.ObjectId,
    cabinClass: CabinClass,
    priceCents: number,
    bookedSeats = 0,
  ) =>
    cabins.collection.insertOne({
      flightId: forFlight,
      cabinClass,
      totalSeats: 100,
      bookedSeats,
      heldSeats: 0,
      priceCents,
      freeBags: 1,
      maxBagWeightKg: 23,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'flt04_cabins_list_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(server.getUri()),
        MongooseModule.forFeature([
          { name: Flight.name, schema: FlightSchema },
          { name: Cabin.name, schema: CabinSchema },
        ]),
      ],
      providers: [FlightCabinsService],
    }).compile();
    await moduleRef.init();
    flights = moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    cabins = moduleRef.get<Model<Cabin>>(getModelToken(Cabin.name));
    service = moduleRef.get(FlightCabinsService);
  });

  afterAll(async () => {
    await moduleRef.close();
    await server.stop();
  });

  beforeEach(async () => {
    await flights.deleteMany({});
    await cabins.deleteMany({});
    await insertFlight(flightId, mine, FlightStatus.SCHEDULED);
    await insertFlight(otherFlightId, other, FlightStatus.SCHEDULED);
    await insertCabin(flightId, CabinClass.ECONOMY, 45000, 7);
    await insertCabin(flightId, CabinClass.BUSINESS, 120000);
    await insertCabin(otherFlightId, CabinClass.ECONOMY, 1000);
  });

  it('lists the cabins of my own flight with id, totals and seats taken, dearest first', async () => {
    const page = await service.list(moderator(mine), flightId.toString(), {});
    expect(page.items.map((c) => c.cabinClass)).toEqual([
      CabinClass.BUSINESS,
      CabinClass.ECONOMY,
    ]);
    const economy = page.items[1];
    expect(economy.id).toEqual(expect.any(String));
    expect(economy).toMatchObject({
      totalSeats: 100,
      bookedSeats: 7,
      availableSeats: 93,
      priceCents: 45000,
    });
    expect(page.total).toBe(2);
  });

  it('still lists the cabins of a cancelled flight (read only)', async () => {
    await flights.updateOne(
      { _id: flightId },
      { $set: { status: FlightStatus.CANCELLED } },
    );
    const page = await service.list(moderator(mine), flightId.toString(), {});
    expect(page.total).toBe(2);
  });

  it('paginates', async () => {
    const page = await service.list(moderator(mine), flightId.toString(), {
      page: 2,
      limit: 1,
    });
    expect(page.items.map((c) => c.cabinClass)).toEqual([CabinClass.ECONOMY]);
    expect(page.total).toBe(2);
  });

  it('refuses another airline flight with 403', async () => {
    await expect(
      service.list(moderator(mine), otherFlightId.toString(), {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 404 for an unknown flight and 403 for a user without an airline', async () => {
    await expect(
      service.list(moderator(mine), new Types.ObjectId().toString(), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.list(moderator(), flightId.toString(), {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
