import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser, CabinClass, Role } from '../common';
import { FlightSearchService } from '../flights/flight-search.service';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { ItineraryFlightsService } from './itinerary-flights.service';
import { Itinerary } from './schemas/itinerary.schema';

jest.setTimeout(60000);

/** Dates relative to today (UTC), so the "flight has not left yet" rule of the flight search never makes this stale. */
const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('Flights from an itinerary (ITN-26) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let connection: Connection;
  let model: Model<Itinerary>;
  let service: ItinerariesService;
  let flights: ItineraryFlightsService;
  let flightSearch: FlightSearchService;
  let airlineId: Types.ObjectId;

  const userWithId = (): AuthenticatedUser => ({
    userId: new Types.ObjectId().toString(),
    role: Role.USER,
  });
  const owner = userWithId();
  const stranger = userWithId();
  const base = { passengers: 1, page: 1, limit: 10 } as const;

  const airport = (iata: string, cityId: string, countryCode: string) => ({
    iata_code: iata,
    name: `${iata} airport`,
    city_id: cityId,
    country_code: countryCode,
    time_zone: 'UTC',
  });

  /** A flight that leaves at noon UTC on `departureDay` and lands 2 hours later. */
  const flight = (
    flightNumber: string,
    from: string,
    to: string,
    departureDay: string,
  ) => {
    const departureAt = new Date(`${departureDay}T12:00:00.000Z`);
    return {
      _id: new Types.ObjectId(),
      airlineId,
      flightNumber,
      departureAirport: from,
      arrivalAirport: to,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 2 * 3_600_000),
      departureTimeZone: 'UTC',
      arrivalTimeZone: 'UTC',
      departureLocalDate: departureDay,
      status: 'SCHEDULED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  const cabin = (flightId: Types.ObjectId, priceCents: number) => ({
    flightId,
    cabinClass: CabinClass.ECONOMY,
    totalSeats: 10,
    bookedSeats: 0,
    heldSeats: 0,
    priceCents,
    freeBags: 1,
    maxBagWeightKg: 23,
  });

  /**
   * Starts on day(10): day 1 and 2 in Cairo, day 3 in Luxor. So the first day is in Cairo (airports CAI and HBE),
   * the start date is day(10) and the last day is day(12).
   */
  const planned = async (by: AuthenticatedUser = owner) => {
    const { id } = await service.create(by, {
      title: 'Nile trip',
      countryCodes: ['EG'],
      startDate: day(10),
    });
    for (const cityId of ['cairo', 'cairo', 'luxor']) {
      await service.addDay(by, id, { cityId });
    }
    return id;
  };

  const seedFlights = async () => {
    const rows = [
      flight('BA1', 'LHR', 'CAI', day(10)),
      flight('BA2', 'LHR', 'HBE', day(10)),
      flight('BA3', 'LHR', 'LXR', day(10)),
      flight('BA4', 'CAI', 'LHR', day(12)),
      flight('BA5', 'LHR', 'CAI', day(14)),
      flight('BA6', 'CAI', 'LHR', day(16)),
      flight('BA7', 'LHR', 'CAI', day(11)),
    ];
    await connection.collection('flights').insertMany(rows);
    await connection
      .collection('cabins')
      .insertMany(rows.map((row, i) => cabin(row._id, 10_000 + i)));
  };

  const numbers = (page: { items: { flightNumber: string }[] }) =>
    page.items.map((item) => item.flightNumber);

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'itn26_flights_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), ItinerariesModule],
    }).compile();
    await moduleRef.init();
    model = moduleRef.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    service = moduleRef.get(ItinerariesService);
    flights = moduleRef.get(ItineraryFlightsService);
    // The instance ItineraryFlightsService uses is the one provided by ItinerariesModule, not FlightsModule's own.
    flightSearch = moduleRef
      .select(ItinerariesModule)
      .get(FlightSearchService, { strict: true });
    await model.init();

    connection = moduleRef.get<Connection>(getConnectionToken());
    await connection.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
    ]);
    await connection.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'luxor', name: 'Luxor', country_code: 'EG' },
      { city_id: 'aswan', name: 'Aswan', country_code: 'EG' },
      { city_id: 'london', name: 'London', country_code: 'GB' },
    ]);
    await connection
      .collection('airports')
      .insertMany([
        airport('CAI', 'cairo', 'EG'),
        airport('HBE', 'cairo', 'EG'),
        airport('LXR', 'luxor', 'EG'),
        airport('LHR', 'london', 'GB'),
      ]);
    airlineId = new Types.ObjectId();
    await connection.collection('airlines').insertOne({
      _id: airlineId,
      name: 'Test Air',
      code: 'TA',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await seedFlights();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  describe('the destination', () => {
    it('covers every airport in the city of the first day, and no airport of another city', async () => {
      const id = await planned();

      const result = await flights.flightsForItinerary(owner, id, {
        departureAirport: 'LHR',
        tripType: 'ONE_WAY',
        ...base,
      } as never);

      expect(result.destinations.map((d) => d.airport.iataCode)).toEqual([
        'CAI',
        'HBE',
      ]);
      expect(result.destinationCityId).toBe('cairo');
    });

    it('lists the flights of each airport of that city (one-way, on the start date)', async () => {
      const id = await planned();

      const result = await flights.flightsForItinerary(owner, id, {
        departureAirport: 'LHR',
        tripType: 'ONE_WAY',
        ...base,
      } as never);

      const [cai, hbe] = result.destinations;
      expect(numbers(cai.results as never)).toEqual(['BA1']);
      expect(numbers(hbe.results as never)).toEqual(['BA2']);
    });

    it('leaves out the airport the user flies from when it is in the same city', async () => {
      const id = await planned();

      const result = await flights.flightsForItinerary(owner, id, {
        departureAirport: 'CAI',
        tripType: 'ONE_WAY',
        ...base,
      } as never);

      expect(result.destinations.map((d) => d.airport.iataCode)).toEqual([
        'HBE',
      ]);
    });

    it('is a 400 on departureAirport when the origin is the only airport of the city', async () => {
      const { id } = await service.create(owner, {
        title: 'Luxor',
        countryCodes: ['EG'],
        startDate: day(10),
      });
      await service.addDay(owner, id, { cityId: 'luxor' });

      await expect(
        flights.flightsForItinerary(owner, id, {
          departureAirport: 'LXR',
          tripType: 'ONE_WAY',
          ...base,
        } as never),
      ).rejects.toMatchObject({
        response: {
          details: [{ field: 'departureAirport', message: expect.any(String) }],
        },
      });
    });

    it('is a 400 when the city of the first day has no airport', async () => {
      const { id } = await service.create(owner, {
        title: 'Aswan',
        countryCodes: ['EG'],
        startDate: day(10),
      });
      await service.addDay(owner, id, { cityId: 'aswan' });

      await expect(
        flights.flightsForItinerary(owner, id, {
          departureAirport: 'LHR',
          tripType: 'ONE_WAY',
          ...base,
        } as never),
      ).rejects.toMatchObject({
        response: { details: [{ field: 'id', message: expect.any(String) }] },
      });
    });

    it('is a 400 when the itinerary has no days yet, so there is no first-day city', async () => {
      const { id } = await service.create(owner, {
        title: 'Empty',
        countryCodes: ['EG'],
        startDate: day(10),
      });

      await expect(
        flights.flightsForItinerary(owner, id, {
          departureAirport: 'LHR',
          tripType: 'ONE_WAY',
          ...base,
        } as never),
      ).rejects.toMatchObject({
        response: { details: [{ field: 'id', message: expect.any(String) }] },
      });
    });
  });

  describe('the dates', () => {
    it('outbound defaults to the start date and the return to the date of the last day (round trip)', async () => {
      const id = await planned();

      const result = await flights.flightsForItinerary(owner, id, {
        departureAirport: 'LHR',
        tripType: 'ROUND_TRIP',
        ...base,
      } as never);

      expect(result).toMatchObject({
        tripType: 'ROUND_TRIP',
        departureDate: day(10),
        returnDate: day(12),
      });
      const cai = result.destinations[0].results as unknown as {
        outbound: { items: { flightNumber: string }[] };
        return: { items: { flightNumber: string }[] };
      };
      expect(numbers(cai.outbound)).toEqual(['BA1']);
      // the return leg is the reverse route (CAI to LHR) on the date of the last day
      expect(numbers(cai.return)).toEqual(['BA4']);
    });

    it('is a round trip when tripType is not given', async () => {
      const id = await planned();

      const result = await flights.flightsForItinerary(owner, id, {
        departureAirport: 'LHR',
        ...base,
      } as never);

      expect(result.tripType).toBe('ROUND_TRIP');
      expect(result.returnDate).toBe(day(12));
    });

    it('a one-way search has no return date and no return leg', async () => {
      const id = await planned();

      const result = await flights.flightsForItinerary(owner, id, {
        departureAirport: 'LHR',
        tripType: 'ONE_WAY',
        ...base,
      } as never);

      expect(result.returnDate).toBeNull();
      expect(result.departureDate).toBe(day(10));
      expect(result.destinations[0].results).not.toHaveProperty('return');
    });

    it('both dates can be overridden', async () => {
      const id = await planned();

      const result = await flights.flightsForItinerary(owner, id, {
        departureAirport: 'LHR',
        tripType: 'ROUND_TRIP',
        departureDate: day(14),
        returnDate: day(16),
        ...base,
      } as never);

      expect(result).toMatchObject({
        departureDate: day(14),
        returnDate: day(16),
      });
      const cai = result.destinations[0].results as unknown as {
        outbound: { items: { flightNumber: string }[] };
        return: { items: { flightNumber: string }[] };
      };
      expect(numbers(cai.outbound)).toEqual(['BA5']);
      expect(numbers(cai.return)).toEqual(['BA6']);
    });

    it('the outbound date can be overridden on its own and the return date stays the default', async () => {
      const id = await planned();

      const result = await flights.flightsForItinerary(owner, id, {
        departureAirport: 'LHR',
        tripType: 'ROUND_TRIP',
        departureDate: day(11),
        ...base,
      } as never);

      expect(result).toMatchObject({
        departureDate: day(11),
        returnDate: day(12),
      });
    });

    it('a returnDate on a one-way search is a 400 on returnDate', async () => {
      const id = await planned();

      await expect(
        flights.flightsForItinerary(owner, id, {
          departureAirport: 'LHR',
          tripType: 'ONE_WAY',
          returnDate: day(12),
          ...base,
        } as never),
      ).rejects.toMatchObject({
        response: {
          details: [{ field: 'returnDate', message: expect.any(String) }],
        },
      });
    });

    it('a return date before the outbound date is refused by the flight search with a 400 on returnDate', async () => {
      const id = await planned();

      await expect(
        flights.flightsForItinerary(owner, id, {
          departureAirport: 'LHR',
          tripType: 'ROUND_TRIP',
          departureDate: day(12),
          returnDate: day(11),
          ...base,
        } as never),
      ).rejects.toMatchObject({
        response: {
          details: [{ field: 'returnDate', message: expect.any(String) }],
        },
      });
    });
  });

  describe('reuse of the flight search (FLT-11, FLT-12)', () => {
    it('calls FlightSearchService once per airport with the route, dates, passengers, filters and paging (no search logic of its own)', async () => {
      const id = await planned();
      const spy = jest.spyOn(flightSearch, 'search');

      await flights.flightsForItinerary(owner, id, {
        departureAirport: 'LHR',
        tripType: 'ROUND_TRIP',
        passengers: 3,
        cabinClass: CabinClass.ECONOMY,
        minPrice: 100,
        maxPrice: 50_000,
        sort: 'price',
        order: 'desc',
        page: 2,
        limit: 5,
      } as never);

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls.map(([q]) => q.arrivalAirport).sort()).toEqual([
        'CAI',
        'HBE',
      ]);
      expect(spy.mock.calls[0][0]).toMatchObject({
        departureAirport: 'LHR',
        departureDate: day(10),
        returnDate: day(12),
        passengers: 3,
        cabinClass: CabinClass.ECONOMY,
        minPrice: 100,
        maxPrice: 50_000,
        sort: 'price',
        order: 'desc',
        page: 2,
        limit: 5,
      });
      spy.mockRestore();
    });

    it('a one-way search is sent without a returnDate', async () => {
      const id = await planned();
      const spy = jest.spyOn(flightSearch, 'search');

      await flights.flightsForItinerary(owner, id, {
        departureAirport: 'LHR',
        tripType: 'ONE_WAY',
        ...base,
      } as never);

      expect(spy.mock.calls[0][0].returnDate).toBeUndefined();
      spy.mockRestore();
    });

    it('an unknown origin airport is refused by the flight search with a 400 on departureAirport', async () => {
      const id = await planned();

      await expect(
        flights.flightsForItinerary(owner, id, {
          departureAirport: 'ZZZ',
          tripType: 'ONE_WAY',
          ...base,
        } as never),
      ).rejects.toMatchObject({
        response: {
          details: [{ field: 'departureAirport', message: expect.any(String) }],
        },
      });
    });
  });

  describe('ownership', () => {
    it("someone else's itinerary answers 404, and so does an unknown one", async () => {
      const id = await planned();

      await expect(
        flights.flightsForItinerary(stranger, id, {
          departureAirport: 'LHR',
          ...base,
        } as never),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        flights.flightsForItinerary(owner, new Types.ObjectId().toString(), {
          departureAirport: 'LHR',
          ...base,
        } as never),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
