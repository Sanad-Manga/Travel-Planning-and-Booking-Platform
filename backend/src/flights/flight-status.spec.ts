import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { FlightStatus } from '../common';
import { toFlightResponse } from './dto/flight-response.dto';
import { FlightStatusJob } from './flight-status.job';
import { Flight, FlightLean, FlightSchema } from './schemas/flight.schema';
import { effectiveFlightStatus } from './utils/flight-status';

jest.setTimeout(60000);

const NOW = new Date('2026-12-01T12:00:00.000Z');
const minutesFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe('effectiveFlightStatus (FLT-30)', () => {
  it('reads a SCHEDULED flight whose departure has passed as DEPARTED', () => {
    expect(
      effectiveFlightStatus(
        { status: FlightStatus.SCHEDULED, departureAt: minutesFromNow(-1) },
        NOW,
      ),
    ).toBe(FlightStatus.DEPARTED);
    // departing exactly now counts as departed
    expect(
      effectiveFlightStatus(
        { status: FlightStatus.SCHEDULED, departureAt: NOW },
        NOW,
      ),
    ).toBe(FlightStatus.DEPARTED);
  });

  it('keeps a future SCHEDULED flight SCHEDULED', () => {
    expect(
      effectiveFlightStatus(
        { status: FlightStatus.SCHEDULED, departureAt: minutesFromNow(1) },
        NOW,
      ),
    ).toBe(FlightStatus.SCHEDULED);
  });

  it('never turns a CANCELLED flight into DEPARTED', () => {
    expect(
      effectiveFlightStatus(
        { status: FlightStatus.CANCELLED, departureAt: minutesFromNow(-60) },
        NOW,
      ),
    ).toBe(FlightStatus.CANCELLED);
  });

  it('is what the flight response shows', () => {
    const doc = {
      _id: new Types.ObjectId(),
      airlineId: new Types.ObjectId(),
      flightNumber: 'MS1',
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt: minutesFromNow(-5),
      arrivalAt: minutesFromNow(600),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/New_York',
      departureLocalDate: '2026-12-01',
      status: FlightStatus.SCHEDULED,
      createdAt: NOW,
      updatedAt: NOW,
    } as FlightLean;
    expect(toFlightResponse(doc, NOW).status).toBe(FlightStatus.DEPARTED);
  });
});

describe('FlightStatusJob (FLT-30) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let flights: Model<Flight>;
  let job: FlightStatusJob;

  const insert = (status: FlightStatus, departureAt: Date, number: string) =>
    flights.collection.insertOne({
      airlineId: new Types.ObjectId(),
      flightNumber: number,
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 3_600_000),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'America/New_York',
      departureLocalDate: '2026-12-01',
      status,
    });
  const statusOf = async (number: string) =>
    (await flights.findOne({ flightNumber: number }).lean())?.status;

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'flt30_status_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(server.getUri()),
        MongooseModule.forFeature([
          { name: Flight.name, schema: FlightSchema },
        ]),
      ],
      providers: [FlightStatusJob],
    }).compile();
    await moduleRef.init();
    flights = moduleRef.get<Model<Flight>>(getModelToken(Flight.name));
    job = moduleRef.get(FlightStatusJob);
  });

  afterAll(async () => {
    await moduleRef.close();
    await server.stop();
  });

  beforeEach(async () => {
    await flights.deleteMany({});
  });

  it('stores DEPARTED on past SCHEDULED flights only', async () => {
    await insert(FlightStatus.SCHEDULED, minutesFromNow(-30), 'PAST');
    await insert(FlightStatus.SCHEDULED, minutesFromNow(30), 'FUTURE');
    await insert(FlightStatus.CANCELLED, minutesFromNow(-30), 'CANCELLED');

    expect(await job.markDeparted(NOW)).toBe(1);

    expect(await statusOf('PAST')).toBe(FlightStatus.DEPARTED);
    expect(await statusOf('FUTURE')).toBe(FlightStatus.SCHEDULED);
    expect(await statusOf('CANCELLED')).toBe(FlightStatus.CANCELLED);
  });

  it('is idempotent', async () => {
    await insert(FlightStatus.SCHEDULED, minutesFromNow(-30), 'PAST');
    expect(await job.markDeparted(NOW)).toBe(1);
    expect(await job.markDeparted(NOW)).toBe(0);
  });
});
