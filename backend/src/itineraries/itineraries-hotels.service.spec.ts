import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser, Role } from '../common';
import { HotelSearchService } from '../hotels/hotel-search.service';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { Itinerary } from './schemas/itinerary.schema';

jest.setTimeout(60000);

/** Dates relative to today (UTC), so the "check-in not in the past" rule of the hotel search never makes this stale. */
const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('Hotels for a city group (ITN-25) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let connection: Connection;
  let model: Model<Itinerary>;
  let service: ItinerariesService;
  let hotelSearch: HotelSearchService;

  const userWithId = (): AuthenticatedUser => ({
    userId: new Types.ObjectId().toString(),
    role: Role.USER,
  });
  const owner = userWithId();
  const stranger = userWithId();
  const page = { page: 1, limit: 10 };

  const hotel = (name: string, cityId: string, countryCode: string) => ({
    _id: new Types.ObjectId(),
    name,
    nameKey: name.toLowerCase(),
    address: '1 Test Street',
    cityId,
    countryCode,
    description: 'Hotel.',
    photos: [],
    starRating: 4,
    amenities: [],
    cancellationTiers: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  /** `from` and `to` are day offsets: the room is free for the nights from..to-1 (the range is half-open). */
  const room = (
    hotelId: Types.ObjectId,
    name: string,
    maxOccupancy: number,
    pricePerNightCents: number,
    from: number,
    to: number,
  ) => ({
    _id: new Types.ObjectId(),
    hotelId,
    name,
    nameKey: name,
    type: 'Double',
    beds: 1,
    maxOccupancy,
    pricePerNightCents,
    isActive: true,
    availability: [
      { _id: new Types.ObjectId(), startDate: day(from), endDate: day(to) },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  /**
   * Starts on day(10): day 1 and 2 in Cairo (group 1, nights day(10) and day(11)), day 3 in Luxor (group 2, night
   * day(12)), day 4 in Cairo again (group 3, night day(13)).
   */
  const planned = async (by: AuthenticatedUser = owner) => {
    const { id } = await service.create(by, {
      title: 'Nile trip',
      countryCodes: ['EG'],
      startDate: day(10),
    });
    for (const cityId of ['cairo', 'cairo', 'luxor', 'cairo']) {
      await service.addDay(by, id, { cityId });
    }
    return id;
  };
  const names = async (
    id: string,
    query: { fromDayNumber: number; guests?: number; rooms?: number },
    by: AuthenticatedUser = owner,
  ) =>
    (
      await service.hotelsForGroup(by, id, { guests: 2, ...page, ...query })
    ).items.map((item) => item.name);

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'itn25_hotels_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), ItinerariesModule],
    }).compile();
    await moduleRef.init();
    model = moduleRef.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    service = moduleRef.get(ItinerariesService);
    // The instance ItinerariesService uses is the one provided by ItinerariesModule, not HotelsModule's own.
    hotelSearch = moduleRef
      .select(ItinerariesModule)
      .get(HotelSearchService, { strict: true });
    await model.init();

    connection = moduleRef.get<Connection>(getConnectionToken());
    await connection
      .collection('countries')
      .insertMany([{ code: 'EG', name: 'Egypt', currency: 'EGP' }]);
    await connection.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'luxor', name: 'Luxor', country_code: 'EG' },
    ]);

    const full = hotel('Full', 'cairo', 'EG');
    const oneNightShort = hotel('One night short', 'cairo', 'EG');
    const big = hotel('Big', 'cairo', 'EG');
    const luxorPalace = hotel('Luxor Palace', 'luxor', 'EG');
    await connection
      .collection('hotels')
      .insertMany([full, oneNightShort, big, luxorPalace]);
    await connection.collection('rooms').insertMany([
      // free for the nights day(10) and day(11) exactly: enough for group 1, not for group 3
      room(full._id, 'f1', 2, 10_000, 10, 12),
      // free for the night day(10) only: the last night of group 1 is missing
      room(oneNightShort._id, 'o1', 2, 5_000, 10, 11),
      // two small rooms, free from day(10) to day(19)
      room(big._id, 'b1', 2, 7_000, 10, 20),
      room(big._id, 'b2', 2, 8_000, 10, 20),
      room(luxorPalace._id, 'l1', 2, 9_000, 12, 13),
    ]);
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  describe('the dates of the group', () => {
    it('searches from the first day of the group to the day after its last day', async () => {
      const id = await planned();

      const result = await service.hotelsForGroup(owner, id, {
        fromDayNumber: 1,
        guests: 2,
        ...page,
      });

      // "Full" is free for exactly the nights day(10) and day(11): it is listed only if check-out is day(12)
      expect(result.items.map((i) => i.name)).toContain('Full');
      expect(result.items.find((i) => i.name === 'Full')).toMatchObject({
        nights: 2,
        cityId: 'cairo',
      });
      // free for the first night only: the second night of the group is missing, so it is not listed
      expect(result.items.map((i) => i.name)).not.toContain('One night short');
    });

    it('hands the dates, the city, guests, rooms and paging to the HTL-11 search (no search logic of its own)', async () => {
      const id = await planned();
      const spy = jest.spyOn(hotelSearch, 'search');

      await service.hotelsForGroup(owner, id, {
        fromDayNumber: 3,
        guests: 3,
        rooms: 2,
        page: 2,
        limit: 5,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({
        cityId: 'luxor',
        checkIn: day(12),
        checkOut: day(13),
        guests: 3,
        rooms: 2,
        page: 2,
        limit: 5,
      });
      spy.mockRestore();
    });

    it('uses the group that starts on the given day when a city comes up twice (Cairo, Luxor, Cairo)', async () => {
      const id = await planned();

      expect(await names(id, { fromDayNumber: 1 })).toEqual(
        expect.arrayContaining(['Full', 'Big']),
      );
      expect(await names(id, { fromDayNumber: 3 })).toEqual(['Luxor Palace']);
      // the second Cairo group is only the night day(13): "Full" is not free then, "Big" is
      const third = await names(id, { fromDayNumber: 4 });
      expect(third).toContain('Big');
      expect(third).not.toContain('Full');
    });

    it('follows the itinerary when it changes: a deleted day moves the group', async () => {
      const id = await planned();
      const { days } = await service.findMine(owner, id);
      await service.removeDay(owner, id, days[0].id); // Cairo, Luxor, Cairo now start on day(10)

      // the group of Luxor starts on day 2 now, and only its night day(11) is searched: nobody is free then
      expect(await names(id, { fromDayNumber: 2 })).toEqual([]);
      // the first group is a single Cairo night day(10): "One night short" fits it now
      expect(await names(id, { fromDayNumber: 1 })).toContain(
        'One night short',
      );
    });
  });

  describe('guests and rooms', () => {
    it('applies the HTL-11 rules to the guest count and the number of rooms the user enters', async () => {
      const id = await planned();

      // "Big" has two rooms for 2 guests each: 4 guests need both rooms
      expect(await names(id, { fromDayNumber: 1, guests: 4 })).toEqual([]);
      expect(
        await names(id, { fromDayNumber: 1, guests: 4, rooms: 2 }),
      ).toEqual(['Big']);
    });

    it('defaults to one room', async () => {
      const id = await planned();
      const spy = jest.spyOn(hotelSearch, 'search');
      await service.hotelsForGroup(owner, id, {
        fromDayNumber: 1,
        guests: 2,
        ...page,
      });
      expect(spy.mock.calls[0][0].rooms).toBe(1);
      spy.mockRestore();
    });
  });

  describe('who can use it', () => {
    it('answers 404 for someone else itinerary and for an unknown id', async () => {
      const id = await planned();
      for (const [by, itineraryId] of [
        [stranger, id],
        [owner, new Types.ObjectId().toString()],
      ] as const) {
        await expect(
          service.hotelsForGroup(by, itineraryId, {
            fromDayNumber: 1,
            guests: 2,
            ...page,
          }),
        ).rejects.toMatchObject({ status: 404 });
      }
    });
  });

  describe('a city group that does not exist', () => {
    it('is a clear 400 on fromDayNumber that names the days where a group starts', async () => {
      const id = await planned();

      // day 2 is inside the first group, day 9 is past the end
      for (const fromDayNumber of [2, 9]) {
        await expect(
          service.hotelsForGroup(owner, id, {
            fromDayNumber,
            guests: 2,
            ...page,
          }),
        ).rejects.toMatchObject({
          status: 400,
          response: {
            details: [
              {
                field: 'fromDayNumber',
                message: expect.stringContaining('1, 3, 4'),
              },
            ],
          },
        });
      }
    });

    it('is a 400 for an itinerary without days', async () => {
      const { id } = await service.create(owner, {
        title: 'Empty',
        countryCodes: ['EG'],
        startDate: day(10),
      });
      await expect(
        service.hotelsForGroup(owner, id, {
          fromDayNumber: 1,
          guests: 2,
          ...page,
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'fromDayNumber' }] },
      });
    });

    it('is a 400 naming fromDayNumber for a group that is already over, and the hotel search is not called', async () => {
      const { id } = await service.create(owner, {
        title: 'Past',
        countryCodes: ['EG'],
        startDate: day(-5),
      });
      await service.addDay(owner, id, { cityId: 'cairo' });
      const spy = jest.spyOn(hotelSearch, 'search');

      await expect(
        service.hotelsForGroup(owner, id, {
          fromDayNumber: 1,
          guests: 2,
          ...page,
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'fromDayNumber' }] },
      });

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
