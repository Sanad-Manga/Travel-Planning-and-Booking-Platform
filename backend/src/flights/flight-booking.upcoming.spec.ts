import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Model, Types } from 'mongoose';
import { BookingStatus, BookingType } from '../common';
import { FlightBookingProvider } from './flight-booking.provider';
import { FlightBooking, FlightBookingSchema } from './schemas/flight-booking.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

jest.setTimeout(120000);

/** ACC-12: the flight side of UpcomingBookingsChecker, against a real (in-memory) MongoDB. */
describe('FlightBookingProvider.hasUpcomingConfirmedBookings (ACC-12)', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let bookings: Model<FlightBooking>;
  let flights: Model<Flight>;
  let provider: FlightBookingProvider;
  const registered: [BookingType, unknown][] = [];

  const NOW = new Date('2026-11-20T12:00:00.000Z');
  const HOUR = 3_600_000;
  const user = new Types.ObjectId();
  const otherUser = new Types.ObjectId();

  // The flights collection has a unique index on { airlineId, flightNumber, departureLocalDate }, so every raw
  // test flight needs its own values for those three fields (documents that omit them all collide on null).
  let flightSeq = 0;
  const flight = async (departureAt: Date): Promise<Types.ObjectId> => {
    const _id = new Types.ObjectId();
    flightSeq += 1;
    await flights.collection.insertOne({
      _id,
      airlineId: new Types.ObjectId(),
      flightNumber: `TS${flightSeq}`,
      departureLocalDate: departureAt.toISOString().slice(0, 10),
      departureAt,
      status: 'SCHEDULED',
    });
    return _id;
  };
  const booking = async (
    flightIds: Types.ObjectId[],
    over: { userId?: Types.ObjectId; status?: BookingStatus; legacy?: boolean } = {},
  ): Promise<void> => {
    await bookings.collection.insertOne({
      userId: over.userId ?? user,
      airlineId: new Types.ObjectId(),
      flightId: flightIds[0],
      ...(over.legacy ? {} : { segments: flightIds.map((flightId) => ({ flightId })) }),
      status: over.status ?? BookingStatus.CONFIRMED,
      createdAt: NOW,
      updatedAt: NOW,
    });
  };
  const check = (id: Types.ObjectId = user) => provider.hasUpcomingConfirmedBookings(id.toString(), NOW);

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await createConnection(server.getUri()).asPromise();
    bookings = connection.model<FlightBooking>(FlightBooking.name, FlightBookingSchema);
    flights = connection.model<Flight>(Flight.name, FlightSchema);
    const registry = { register: jest.fn() };
    const upcoming = { register: (type: BookingType, checker: unknown) => registered.push([type, checker]) };
    provider = new FlightBookingProvider(bookings, flights, connection, {} as never, {} as never, registry as never, {} as never, upcoming as never);
    provider.onModuleInit();
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  beforeEach(async () => {
    await bookings.collection.deleteMany({});
    await flights.collection.deleteMany({});
  });

  it('registers itself as the FLIGHT checker on module init', () => {
    expect(registered).toEqual([[BookingType.FLIGHT, provider]]);
  });

  it('is true for an upcoming confirmed one-way booking, also when it departs exactly now', async () => {
    await booking([await flight(new Date(NOW.getTime() + 5 * HOUR))]);
    await expect(check()).resolves.toBe(true);
    await bookings.collection.deleteMany({});
    await booking([await flight(NOW)]);
    await expect(check()).resolves.toBe(true);
  });

  it('is false when the flight has already departed', async () => {
    await booking([await flight(new Date(NOW.getTime() - HOUR))]);
    await expect(check()).resolves.toBe(false);
  });

  it.each([BookingStatus.PENDING_PAYMENT, BookingStatus.CANCELLED, BookingStatus.EXPIRED, BookingStatus.COMPLETED])(
    'is false for an upcoming %s booking',
    async (status) => {
      await booking([await flight(new Date(NOW.getTime() + 5 * HOUR))], { status });
      await expect(check()).resolves.toBe(false);
    },
  );

  it('round trip: true while the return leg is ahead, false when both legs departed', async () => {
    const departed = await flight(new Date(NOW.getTime() - 48 * HOUR));
    const ahead = await flight(new Date(NOW.getTime() + 48 * HOUR));
    await booking([departed, ahead]);
    await expect(check()).resolves.toBe(true);
    await bookings.collection.deleteMany({});
    await booking([departed, await flight(new Date(NOW.getTime() - HOUR))]);
    await expect(check()).resolves.toBe(false);
  });

  it('round trip: true when only the outbound leg is ahead', async () => {
    await booking([await flight(new Date(NOW.getTime() + HOUR)), await flight(new Date(NOW.getTime() + 99 * HOUR))]);
    await expect(check()).resolves.toBe(true);
  });

  it('a legacy booking without segments uses its top-level flight', async () => {
    await booking([await flight(new Date(NOW.getTime() + HOUR))], { legacy: true });
    await expect(check()).resolves.toBe(true);
    await bookings.collection.deleteMany({});
    await booking([await flight(new Date(NOW.getTime() - HOUR))], { legacy: true });
    await expect(check()).resolves.toBe(false);
  });

  it('with several bookings, one upcoming confirmed booking is enough', async () => {
    await booking([await flight(new Date(NOW.getTime() - HOUR))]);
    await booking([await flight(new Date(NOW.getTime() + HOUR))], { status: BookingStatus.CANCELLED });
    await booking([await flight(new Date(NOW.getTime() + 2 * HOUR))]);
    await booking([await flight(new Date(NOW.getTime() + 3 * HOUR))]);
    await expect(check()).resolves.toBe(true);
  });

  it('another user upcoming booking does not count', async () => {
    await booking([await flight(new Date(NOW.getTime() + 5 * HOUR))], { userId: otherUser });
    await expect(check()).resolves.toBe(false);
    await expect(check(otherUser)).resolves.toBe(true);
  });

  it('is false for a user without bookings and for a malformed id, without querying', async () => {
    await expect(check()).resolves.toBe(false);
    const spy = jest.spyOn(bookings, 'aggregate');
    await expect(provider.hasUpcomingConfirmedBookings('not-an-id', NOW)).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('throws a database error instead of answering false', async () => {
    const spy = jest.spyOn(bookings, 'aggregate').mockRejectedValue(new Error('db down'));
    await expect(check()).rejects.toThrow('db down');
    spy.mockRestore();
  });
});
