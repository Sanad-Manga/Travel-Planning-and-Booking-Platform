import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser, PLATFORM_CURRENCY, Role } from '../common';
import { ActivitiesService } from './activities.service';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { Activity } from './schemas/activity.schema';

jest.setTimeout(60000);

describe('ActivitiesService (ITN-10) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let activities: ActivitiesService;
  let itineraries: ItinerariesService;
  let activityModel: Model<Activity>;

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
  const storedCount = (itineraryId: string) =>
    activityModel
      .countDocuments({ itineraryId: new Types.ObjectId(itineraryId) })
      .exec();

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'itn10_activities_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), ItinerariesModule],
    }).compile();
    await moduleRef.init();
    activities = moduleRef.get(ActivitiesService);
    itineraries = moduleRef.get(ItinerariesService);
    activityModel = moduleRef.get<Model<Activity>>(
      getModelToken(Activity.name),
    );
    await activityModel.init();

    const connection = moduleRef.get<Connection>(getConnectionToken());
    await connection.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
    ]);
    await connection.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'dubai', name: 'Dubai', country_code: 'AE' },
    ]);
  });

  beforeEach(async () => {
    await activityModel.deleteMany({});
    await moduleRef
      .get<Model<unknown>>(getModelToken('Itinerary'))
      .deleteMany({});
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  describe('create', () => {
    it('adds an activity with only a name: no description, time or cost', async () => {
      const { id, first } = await withTwoDays();

      const created = await activities.create(owner, id, first.id, {
        name: 'Pyramids of Giza',
      });

      expect(created).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        itineraryId: id,
        dayId: first.id,
        name: 'Pyramids of Giza',
        description: '',
        time: null,
        costCents: null,
        currency: PLATFORM_CURRENCY,
      });
      expect(await storedCount(id)).toBe(1);
    });

    it('stores the description, the time and the cost in cents when they are sent', async () => {
      const { id, first } = await withTwoDays();

      const created = await activities.create(owner, id, first.id, {
        name: 'Felucca ride',
        description: 'Sunset on the Nile',
        time: '17:30',
        costCents: 2500,
      });

      expect(created).toMatchObject({
        description: 'Sunset on the Nile',
        time: '17:30',
        costCents: 2500,
      });
    });

    it('accepts a free activity with a cost of 0', async () => {
      const { id, first } = await withTwoDays();
      await expect(
        activities.create(owner, id, first.id, { name: 'Walk', costCents: 0 }),
      ).resolves.toMatchObject({ costCents: 0 });
    });

    it("answers 404 for someone else's itinerary, an unknown itinerary, an unknown day or a day of another itinerary, and saves nothing", async () => {
      const { id, first } = await withTwoDays();
      const other = await withTwoDays();

      await expect(
        activities.create(stranger, id, first.id, { name: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        activities.create(owner, new Types.ObjectId().toString(), first.id, {
          name: 'x',
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        activities.create(owner, id, new Types.ObjectId().toString(), {
          name: 'x',
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        activities.create(owner, id, other.first.id, { name: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await storedCount(id)).toBe(0);
      expect(await storedCount(other.id)).toBe(0);
    });
  });

  describe('edit', () => {
    it('changes only the fields that were sent', async () => {
      const { id, first } = await withTwoDays();
      const created = await activities.create(owner, id, first.id, {
        name: 'Museum',
        description: 'Old kingdom',
        time: '10:00',
        costCents: 1500,
      });

      const edited = await activities.update(owner, created.id, {
        name: 'Egyptian Museum',
        costCents: 1800,
      });

      expect(edited).toEqual({
        ...created,
        name: 'Egyptian Museum',
        costCents: 1800,
      });
    });

    it('clears the time and the cost when null is sent, and the description with an empty string', async () => {
      const { id, first } = await withTwoDays();
      const created = await activities.create(owner, id, first.id, {
        name: 'Museum',
        description: 'Old kingdom',
        time: '10:00',
        costCents: 1500,
      });

      const edited = await activities.update(owner, created.id, {
        time: null,
        costCents: null,
        description: '',
      });

      expect(edited).toMatchObject({
        description: '',
        time: null,
        costCents: null,
      });
      const stored = await activityModel.findById(created.id).lean();
      expect(stored).not.toHaveProperty('time');
      expect(stored).not.toHaveProperty('costCents');
    });

    it('rejects an empty edit with 400 and keeps the activity', async () => {
      const { id, first } = await withTwoDays();
      const created = await activities.create(owner, id, first.id, {
        name: 'Museum',
      });
      await expect(
        activities.update(owner, created.id, {}),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'body' }] },
      });
    });

    it("answers 404 for someone else's activity or an unknown one, and changes nothing", async () => {
      const { id, first } = await withTwoDays();
      const created = await activities.create(owner, id, first.id, {
        name: 'Museum',
      });

      await expect(
        activities.update(stranger, created.id, { name: 'Hijacked' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        activities.update(owner, new Types.ObjectId().toString(), {
          name: 'x',
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect((await activityModel.findById(created.id).lean())?.name).toBe(
        'Museum',
      );
    });
  });

  describe('delete', () => {
    it('removes the activity, and a second delete answers 404', async () => {
      const { id, first } = await withTwoDays();
      const created = await activities.create(owner, id, first.id, {
        name: 'Museum',
      });

      await activities.remove(owner, created.id);

      expect(await storedCount(id)).toBe(0);
      await expect(activities.remove(owner, created.id)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("answers 404 for someone else's activity and keeps it", async () => {
      const { id, first } = await withTwoDays();
      const created = await activities.create(owner, id, first.id, {
        name: 'Museum',
      });
      await expect(
        activities.remove(stranger, created.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(await storedCount(id)).toBe(1);
    });

    it('lets only one of several simultaneous deletes succeed', async () => {
      const { id, first } = await withTwoDays();
      const created = await activities.create(owner, id, first.id, {
        name: 'Museum',
      });

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => activities.remove(owner, created.id)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await storedCount(id)).toBe(0);
    });
  });

  describe('shown on the itinerary', () => {
    it('lists each day activities under that day, by time and then in the order they were added', async () => {
      const { id, first, second } = await withTwoDays();
      await activities.create(owner, id, first.id, {
        name: 'Dinner',
        time: '20:00',
      });
      await activities.create(owner, id, first.id, { name: 'No time given' });
      await activities.create(owner, id, first.id, {
        name: 'Breakfast',
        time: '08:00',
      });
      await activities.create(owner, id, second.id, { name: 'Burj Khalifa' });

      const { days } = await itineraries.findMine(owner, id);

      expect(days[0].activities.map((a) => a.name)).toEqual([
        'Breakfast',
        'Dinner',
        'No time given',
      ]);
      expect(days[1].activities.map((a) => a.name)).toEqual(['Burj Khalifa']);
    });

    it('shows an empty list for a day without activities', async () => {
      const { id } = await withTwoDays();
      const { days } = await itineraries.findMine(owner, id);
      expect(days.map((day) => day.activities)).toEqual([[], []]);
    });

    it('is also part of the edit response of the itinerary', async () => {
      const { id, first } = await withTwoDays();
      await activities.create(owner, id, first.id, { name: 'Museum' });
      const edited = await itineraries.update(owner, id, { title: 'Renamed' });
      expect(edited.days[0].activities.map((a) => a.name)).toEqual(['Museum']);
    });

    it('is deleted with the itinerary, and never touches another itinerary', async () => {
      const { id, first } = await withTwoDays();
      const other = await withTwoDays();
      await activities.create(owner, id, first.id, { name: 'Museum' });
      await activities.create(owner, other.id, other.first.id, {
        name: 'Souk',
      });

      await itineraries.remove(owner, id);

      expect(await storedCount(id)).toBe(0);
      expect(await storedCount(other.id)).toBe(1);
    });

    it('is deleted with its day (ITN-07), and the other days keep theirs', async () => {
      const { id, first, second } = await withTwoDays();
      await activities.create(owner, id, first.id, { name: 'Museum' });
      await activities.create(owner, id, first.id, { name: 'Souk' });
      await activities.create(owner, id, second.id, { name: 'Burj Khalifa' });
      expect(await storedCount(id)).toBe(3);

      await itineraries.removeDay(owner, id, first.id);

      expect(await storedCount(id)).toBe(1);
      const left = await itineraries.findMine(owner, id);
      expect(left.days).toHaveLength(1);
      expect(left.days[0].activities.map((a) => a.name)).toEqual([
        'Burj Khalifa',
      ]);
    });

    it('keeps the activities of a day when someone else tries to delete it', async () => {
      const { id, first } = await withTwoDays();
      await activities.create(owner, id, first.id, { name: 'Museum' });

      await expect(
        itineraries.removeDay(stranger, id, first.id),
      ).rejects.toThrow();

      expect(await storedCount(id)).toBe(1);
    });
  });
});
