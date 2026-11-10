import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser, Role } from '../common';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { TransportCost, TransportMode } from './schemas/transport-cost.schema';
import { TransportCostsService } from './transport-costs.service';

jest.setTimeout(60000);

describe('TransportCostsService (ITN-16) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let transport: TransportCostsService;
  let itineraries: ItinerariesService;
  let model: Model<TransportCost>;

  const userWithId = (): AuthenticatedUser => ({
    userId: new Types.ObjectId().toString(),
    role: Role.USER,
  });
  const owner = userWithId();
  const stranger = userWithId();

  const validItinerary = {
    title: 'Egypt and the UAE',
    countryCodes: ['EG', 'AE'],
    startDate: '2026-12-20',
  };

  /** An itinerary of the owner with two days (cairo, dubai). */
  const withTwoDays = async () => {
    const { id } = await itineraries.create(owner, validItinerary);
    const first = await itineraries.addDay(owner, id, { cityId: 'cairo' });
    const second = await itineraries.addDay(owner, id, { cityId: 'dubai' });
    return { id, first, second };
  };
  const entry = (dayId: string) => ({
    mode: TransportMode.FLIGHT,
    fromCityId: 'cairo',
    toCityId: 'dubai',
    amountCents: 25000,
    currency: 'USD',
    dayId,
  });
  const storedCount = (itineraryId: string) =>
    model
      .countDocuments({ itineraryId: new Types.ObjectId(itineraryId) })
      .exec();

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'itn16_transport_costs_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), ItinerariesModule],
    }).compile();
    await moduleRef.init();
    transport = moduleRef.get(TransportCostsService);
    itineraries = moduleRef.get(ItinerariesService);
    model = moduleRef.get<Model<TransportCost>>(
      getModelToken(TransportCost.name),
    );
    await model.init();

    const connection = moduleRef.get<Connection>(getConnectionToken());
    await connection.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
    ]);
    await connection.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'luxor', name: 'Luxor', country_code: 'EG' },
      { city_id: 'dubai', name: 'Dubai', country_code: 'AE' },
    ]);
    await connection
      .collection('currencies')
      .insertMany([{ code: 'USD' }, { code: 'EGP' }, { code: 'AED' }]);
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  describe('create', () => {
    it('adds an entry with mode, both cities, amount in cents, currency and day', async () => {
      const { id, first } = await withTwoDays();

      const created = await transport.create(owner, id, entry(first.id));

      expect(created).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        itineraryId: id,
        dayId: first.id,
        mode: 'FLIGHT',
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amountCents: 25000,
        currency: 'USD',
      });
      expect(await storedCount(id)).toBe(1);
    });

    it('accepts an amount of 0 and a currency other than the platform one', async () => {
      const { id, first } = await withTwoDays();
      await expect(
        transport.create(owner, id, {
          ...entry(first.id),
          mode: TransportMode.TRAIN,
          amountCents: 0,
          currency: 'EGP',
        }),
      ).resolves.toMatchObject({
        amountCents: 0,
        currency: 'EGP',
        mode: 'TRAIN',
      });
    });

    it("answers 404 for someone else's itinerary or an unknown one, and saves nothing", async () => {
      const { id, first } = await withTwoDays();
      await expect(
        transport.create(stranger, id, entry(first.id)),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        transport.create(
          owner,
          new Types.ObjectId().toString(),
          entry(first.id),
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(await storedCount(id)).toBe(0);
    });

    it('rejects a city that is not in the seeded list with 400, naming the field, and saves nothing', async () => {
      const { id, first } = await withTwoDays();

      await expect(
        transport.create(owner, id, {
          ...entry(first.id),
          fromCityId: 'atlantis',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'fromCityId' }] },
      });
      await expect(
        transport.create(owner, id, {
          ...entry(first.id),
          toCityId: 'atlantis',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'toCityId' }] },
      });
      expect(await storedCount(id)).toBe(0);
    });

    it('reports both unknown cities at once', async () => {
      const { id, first } = await withTwoDays();
      await expect(
        transport.create(owner, id, {
          ...entry(first.id),
          fromCityId: 'atlantis',
          toCityId: 'mordor',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          details: [{ field: 'fromCityId' }, { field: 'toCityId' }],
        },
      });
    });

    it('rejects a currency that is not a supported code with 400', async () => {
      const { id, first } = await withTwoDays();
      await expect(
        transport.create(owner, id, { ...entry(first.id), currency: 'XXX' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'currency' }] },
      });
      expect(await storedCount(id)).toBe(0);
    });

    it('rejects a day that is not a day of this itinerary with 400', async () => {
      const { id } = await withTwoDays();
      const other = await withTwoDays();

      await expect(
        transport.create(owner, id, entry(other.first.id)),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'dayId' }] },
      });
      await expect(
        transport.create(owner, id, entry(new Types.ObjectId().toString())),
      ).rejects.toMatchObject({ status: 400 });
      expect(await storedCount(id)).toBe(0);
    });
  });

  describe('edit', () => {
    it('changes only the fields that were sent', async () => {
      const { id, first } = await withTwoDays();
      const created = await transport.create(owner, id, entry(first.id));

      const edited = await transport.update(owner, created.id, {
        mode: TransportMode.TRAIN,
        amountCents: 18000,
        currency: 'EGP',
        toCityId: 'luxor',
      });

      expect(edited).toEqual({
        ...created,
        mode: 'TRAIN',
        amountCents: 18000,
        currency: 'EGP',
        toCityId: 'luxor',
      });
    });

    it('moves the entry to another day of the same itinerary', async () => {
      const { id, first, second } = await withTwoDays();
      const created = await transport.create(owner, id, entry(first.id));

      const edited = await transport.update(owner, created.id, {
        dayId: second.id,
      });

      expect(edited.dayId).toBe(second.id);
    });

    it('rejects an unknown city, an unsupported currency or a day of another itinerary with 400 and keeps the entry', async () => {
      const { id, first } = await withTwoDays();
      const other = await withTwoDays();
      const created = await transport.create(owner, id, entry(first.id));

      await expect(
        transport.update(owner, created.id, { fromCityId: 'atlantis' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'fromCityId' }] },
      });
      await expect(
        transport.update(owner, created.id, { currency: 'XXX' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'currency' }] },
      });
      await expect(
        transport.update(owner, created.id, { dayId: other.first.id }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'dayId' }] },
      });
      expect(await model.findById(created.id).lean()).toMatchObject({
        fromCityId: 'cairo',
        currency: 'USD',
        dayId: new Types.ObjectId(first.id),
      });
    });

    it('rejects an empty edit with 400', async () => {
      const { id, first } = await withTwoDays();
      const created = await transport.create(owner, id, entry(first.id));
      await expect(
        transport.update(owner, created.id, {}),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'body' }] },
      });
    });

    it("answers 404 for someone else's entry or an unknown one, and changes nothing", async () => {
      const { id, first } = await withTwoDays();
      const created = await transport.create(owner, id, entry(first.id));

      await expect(
        transport.update(stranger, created.id, { amountCents: 1 }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        transport.update(owner, new Types.ObjectId().toString(), {
          amountCents: 1,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect((await model.findById(created.id).lean())?.amountCents).toBe(
        25000,
      );
    });
  });

  describe('delete', () => {
    it('removes the entry, and a second delete answers 404', async () => {
      const { id, first } = await withTwoDays();
      const created = await transport.create(owner, id, entry(first.id));

      await transport.remove(owner, created.id);

      expect(await storedCount(id)).toBe(0);
      await expect(transport.remove(owner, created.id)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("answers 404 for someone else's entry and keeps it", async () => {
      const { id, first } = await withTwoDays();
      const created = await transport.create(owner, id, entry(first.id));
      await expect(
        transport.remove(stranger, created.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(await storedCount(id)).toBe(1);
    });

    it('lets only one of several simultaneous deletes succeed', async () => {
      const { id, first } = await withTwoDays();
      const created = await transport.create(owner, id, entry(first.id));

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => transport.remove(owner, created.id)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('shown on the itinerary', () => {
    it('lists the entries on the itinerary, in the order they were added', async () => {
      const { id, first, second } = await withTwoDays();
      const a = await transport.create(owner, id, entry(first.id));
      const b = await transport.create(owner, id, {
        ...entry(second.id),
        fromCityId: 'dubai',
        toCityId: 'cairo',
        mode: TransportMode.FLIGHT,
      });

      const { transportCosts } = await itineraries.findMine(owner, id);

      expect(transportCosts).toEqual([a, b]);
    });

    it('shows an empty list for an itinerary without entries, and in the edit response', async () => {
      const { id, first } = await withTwoDays();
      expect((await itineraries.findMine(owner, id)).transportCosts).toEqual(
        [],
      );
      const created = await transport.create(owner, id, entry(first.id));
      const edited = await itineraries.update(owner, id, { title: 'Renamed' });
      expect(edited.transportCosts).toEqual([created]);
    });

    it('is deleted with the itinerary, and never touches another itinerary', async () => {
      const { id, first } = await withTwoDays();
      const other = await withTwoDays();
      await transport.create(owner, id, entry(first.id));
      await transport.create(owner, other.id, entry(other.first.id));

      await itineraries.remove(owner, id);

      expect(await storedCount(id)).toBe(0);
      expect(await storedCount(other.id)).toBe(1);
    });

    it('is deleted with its day (ITN-07), and the other days keep theirs', async () => {
      const { id, first, second } = await withTwoDays();
      await transport.create(owner, id, entry(first.id));
      await transport.create(owner, id, entry(first.id));
      await transport.create(owner, id, entry(second.id));
      expect(await storedCount(id)).toBe(3);

      await itineraries.removeDay(owner, id, first.id);

      expect(await storedCount(id)).toBe(1);
      const left = await itineraries.findMine(owner, id);
      expect(left.transportCosts).toHaveLength(1);
      expect(left.transportCosts[0].dayId).toBe(second.id);
    });

    it('keeps the entries of a day when someone else tries to delete it', async () => {
      const { id, first } = await withTwoDays();
      await transport.create(owner, id, entry(first.id));

      await expect(
        itineraries.removeDay(stranger, id, first.id),
      ).rejects.toThrow();

      expect(await storedCount(id)).toBe(1);
    });
  });
});
