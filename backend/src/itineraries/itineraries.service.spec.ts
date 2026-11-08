import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Collection, Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser, Role, Visibility } from '../common';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { Itinerary } from './schemas/itinerary.schema';

jest.setTimeout(60000);

describe('ItinerariesService (ITN-01) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let model: Model<Itinerary>;
  let service: ItinerariesService;
  let users: Collection;

  const userWithId = (): AuthenticatedUser => ({
    userId: new Types.ObjectId().toString(),
    role: Role.USER,
  });
  const owner = userWithId();
  const stranger = userWithId();

  const validDto = {
    title: 'Two weeks in Egypt and the UAE',
    countryCodes: ['EG', 'AE'],
    startDate: '2026-12-20',
  };

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'itn01_itineraries_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), ItinerariesModule],
    }).compile();
    await moduleRef.init();
    model = moduleRef.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    service = moduleRef.get(ItinerariesService);
    await model.init();

    const connection = moduleRef.get<Connection>(getConnectionToken());
    users = connection.collection('users');
    // The seeded countries and cities this module is allowed to accept (the real seed has many more).
    await connection.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
      { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
    ]);
    await connection.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'luxor', name: 'Luxor', country_code: 'EG' },
      { city_id: 'dubai', name: 'Dubai', country_code: 'AE' },
    ]);
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  describe('create', () => {
    it('creates a private itinerary owned by the caller and returns a DTO', async () => {
      const result = await service.create(owner, validDto);
      expect(result).toMatchObject({
        authorId: owner.userId,
        title: validDto.title,
        countryCodes: ['EG', 'AE'],
        startDate: '2026-12-20',
        visibility: Visibility.PRIVATE,
        isHidden: false,
      });
      expect(result.id).toMatch(/^[0-9a-f]{24}$/);
      expect(Object.keys(result)).not.toEqual(
        expect.arrayContaining(['_id', '__v']),
      );
      expect(await model.countDocuments()).toBe(1);
    });

    it('rejects an unknown country code with a field-level 400 and saves nothing', async () => {
      await expect(
        service.create(owner, {
          ...validDto,
          countryCodes: ['EG', 'XX', 'YY'],
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          details: [
            {
              field: 'countryCodes',
              message: expect.stringContaining('XX, YY'),
            },
          ],
        },
      });
      expect(await model.countDocuments()).toBe(0);
    });
  });

  describe('listMine (ITN-03)', () => {
    /** Sets updatedAt directly in MongoDB, so the order does not depend on how fast the test runs. */
    const setUpdatedAt = (id: string, iso: string) =>
      model.collection.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { updatedAt: new Date(iso) } },
      );

    it("lists only the caller's itineraries, most recently updated first", async () => {
      const older = await service.create(owner, { ...validDto, title: 'A' });
      const newer = await service.create(owner, { ...validDto, title: 'B' });
      await service.create(stranger, { ...validDto, title: 'Not mine' });
      await setUpdatedAt(older.id, '2026-11-01T10:00:00.000Z');
      await setUpdatedAt(newer.id, '2026-11-02T10:00:00.000Z');

      const result = await service.listMine(owner, { page: 1, limit: 10 });

      expect(result).toMatchObject({ page: 1, limit: 10, total: 2 });
      expect(result.items.map((row) => row.title)).toEqual(['B', 'A']);
      expect(result.items[0]).toEqual({
        id: newer.id,
        title: 'B',
        countryCodes: ['EG', 'AE'],
        startDate: '2026-12-20',
        dayCount: 0,
        visibility: Visibility.PRIVATE,
        isHidden: false,
        updatedAt: '2026-11-02T10:00:00.000Z',
      });
    });

    it('moves an itinerary to the top when it is edited', async () => {
      const first = await service.create(owner, { ...validDto, title: 'A' });
      const second = await service.create(owner, { ...validDto, title: 'B' });
      await setUpdatedAt(first.id, '2026-11-01T10:00:00.000Z');
      await setUpdatedAt(second.id, '2026-11-02T10:00:00.000Z');

      await service.update(owner, first.id, { title: 'A edited' });

      const result = await service.listMine(owner, { page: 1, limit: 10 });
      expect(result.items.map((row) => row.title)).toEqual(['A edited', 'B']);
    });

    it('paginates: each row on exactly one page', async () => {
      for (let i = 1; i <= 3; i++) {
        const { id } = await service.create(owner, {
          ...validDto,
          title: `Trip ${i}`,
        });
        await setUpdatedAt(id, `2026-11-0${i}T10:00:00.000Z`);
      }

      const page1 = await service.listMine(owner, { page: 1, limit: 2 });
      const page2 = await service.listMine(owner, { page: 2, limit: 2 });

      expect(page1).toMatchObject({ total: 3, totalPages: 2 });
      expect(page1.items.map((row) => row.title)).toEqual(['Trip 3', 'Trip 2']);
      expect(page2.items.map((row) => row.title)).toEqual(['Trip 1']);
    });

    it('still lists a hidden itinerary to its author', async () => {
      const { id } = await service.create(owner, validDto);
      await model.updateOne({ _id: id }, { isHidden: true });

      const result = await service.listMine(owner, { page: 1, limit: 10 });
      expect(result.items).toEqual([
        expect.objectContaining({ id, isHidden: true }),
      ]);
    });

    it('returns an empty page when the caller has none', async () => {
      await service.create(stranger, validDto);
      await expect(
        service.listMine(owner, { page: 1, limit: 10 }),
      ).resolves.toEqual({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('findMine (ITN-03)', () => {
    it('returns the full itinerary to its owner', async () => {
      const created = await service.create(owner, validDto);
      await expect(service.findMine(owner, created.id)).resolves.toEqual(
        created,
      );
    });

    it("answers 404 for someone else's itinerary, even a public one (public viewing is a separate route)", async () => {
      const { id } = await service.create(owner, validDto);
      await service.update(owner, id, { visibility: Visibility.PUBLIC });
      await expect(service.findMine(stranger, id)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('answers 404 for an id that does not exist', async () => {
      await expect(
        service.findMine(owner, new Types.ObjectId().toString()),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('searchPublic (ITN-20)', () => {
    /** An account as UsersService.isActive reads it (email is unique in the users collection). */
    const setStatus = (user: AuthenticatedUser, status: string) =>
      users.updateOne(
        { _id: new Types.ObjectId(user.userId) },
        {
          $set: { status },
          $setOnInsert: { email: `${user.userId}@example.com` },
        },
        { upsert: true },
      );
    const setUpdatedAt = (id: string, iso: string) =>
      model.collection.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { updatedAt: new Date(iso) } },
      );
    /** Creates an itinerary and makes it public. */
    const createPublic = async (author: AuthenticatedUser, title: string) => {
      const { id } = await service.create(author, { ...validDto, title });
      await service.update(author, id, { visibility: Visibility.PUBLIC });
      return id;
    };
    const firstPage = { page: 1, limit: 10 };

    beforeEach(async () => {
      await setStatus(owner, 'ACTIVE');
      await setStatus(stranger, 'ACTIVE');
    });

    it('lists only public itineraries, newest edit first, without visibility or hidden flag', async () => {
      const older = await createPublic(owner, 'Older');
      const newer = await createPublic(stranger, 'Newer');
      await service.create(owner, { ...validDto, title: 'Private' });
      await setUpdatedAt(older, '2026-11-01T10:00:00.000Z');
      await setUpdatedAt(newer, '2026-11-02T10:00:00.000Z');

      const result = await service.searchPublic(firstPage);

      expect(result).toMatchObject({ page: 1, limit: 10, total: 2 });
      expect(result.items).toEqual([
        {
          id: newer,
          authorId: stranger.userId,
          title: 'Newer',
          countryCodes: ['EG', 'AE'],
          startDate: '2026-12-20',
          updatedAt: '2026-11-02T10:00:00.000Z',
        },
        expect.objectContaining({ id: older, title: 'Older' }),
      ]);
    });

    it('drops an itinerary as soon as it is set private again', async () => {
      const id = await createPublic(owner, 'Shared');
      await service.update(owner, id, { visibility: Visibility.PRIVATE });
      await expect(service.searchPublic(firstPage)).resolves.toMatchObject({
        items: [],
        total: 0,
      });
    });

    it('leaves out a public itinerary hidden by an admin', async () => {
      const id = await createPublic(owner, 'Hidden');
      await model.updateOne({ _id: id }, { isHidden: true });
      await expect(service.searchPublic(firstPage)).resolves.toMatchObject({
        items: [],
        total: 0,
      });
    });

    it.each(['SUSPENDED', 'DEACTIVATED'])(
      'leaves out the public itineraries of a %s author, and counts only what is shown',
      async (status) => {
        await createPublic(owner, 'Gone');
        const kept = await createPublic(stranger, 'Kept');
        await setStatus(owner, status);

        const result = await service.searchPublic(firstPage);

        expect(result).toMatchObject({ total: 1, totalPages: 1 });
        expect(result.items.map((row) => row.id)).toEqual([kept]);
      },
    );

    it('paginates: each row on exactly one page', async () => {
      for (let i = 1; i <= 3; i++) {
        const id = await createPublic(owner, `Trip ${i}`);
        await setUpdatedAt(id, `2026-11-0${i}T10:00:00.000Z`);
      }
      const page1 = await service.searchPublic({ page: 1, limit: 2 });
      const page2 = await service.searchPublic({ page: 2, limit: 2 });
      expect(page1).toMatchObject({ total: 3, totalPages: 2 });
      expect(page1.items.map((row) => row.title)).toEqual(['Trip 3', 'Trip 2']);
      expect(page2.items.map((row) => row.title)).toEqual(['Trip 1']);
    });
  });

  describe('update', () => {
    it('lets the owner change title, countries and start date', async () => {
      const { id } = await service.create(owner, validDto);
      const result = await service.update(owner, id, {
        title: 'Egypt only',
        countryCodes: ['EG'],
        startDate: '2027-01-05',
      });
      expect(result).toMatchObject({
        id,
        title: 'Egypt only',
        countryCodes: ['EG'],
        startDate: '2027-01-05',
        visibility: Visibility.PRIVATE,
      });
    });

    it('lets the owner set visibility to PUBLIC and back to PRIVATE (ITN-20)', async () => {
      const { id } = await service.create(owner, validDto);
      await expect(
        service.update(owner, id, { visibility: Visibility.PUBLIC }),
      ).resolves.toMatchObject({ visibility: Visibility.PUBLIC });
      await expect(
        service.update(owner, id, { visibility: Visibility.PRIVATE }),
      ).resolves.toMatchObject({ visibility: Visibility.PRIVATE });
    });

    it('keeps a public itinerary owner-only for changes: 404 and no change (ITN-20)', async () => {
      const { id } = await service.create(owner, validDto);
      await service.update(owner, id, { visibility: Visibility.PUBLIC });
      await expect(
        service.update(stranger, id, { visibility: Visibility.PRIVATE }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.update(stranger, id, { title: 'Hijacked' }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await model.findById(id).lean()).toMatchObject({
        title: validDto.title,
        visibility: Visibility.PUBLIC,
      });
    });

    it('changes only the fields that were sent', async () => {
      const { id } = await service.create(owner, validDto);
      const result = await service.update(owner, id, { title: 'New title' });
      expect(result).toMatchObject({
        title: 'New title',
        countryCodes: ['EG', 'AE'],
        startDate: '2026-12-20',
      });
    });

    it("answers 404 for someone else's itinerary and leaves it unchanged", async () => {
      const { id } = await service.create(owner, validDto);
      await expect(
        service.update(stranger, id, { title: 'Hijacked' }),
      ).rejects.toMatchObject({ status: 404 });
      expect((await model.findById(id).lean())?.title).toBe(validDto.title);
    });

    it('answers 404 for an id that does not exist', async () => {
      await expect(
        service.update(owner, new Types.ObjectId().toString(), { title: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('rejects an empty body with 400', async () => {
      const { id } = await service.create(owner, validDto);
      await expect(service.update(owner, id, {})).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'body' }] },
      });
    });

    it('rejects an unknown country with 400 and keeps the old countries', async () => {
      const { id } = await service.create(owner, validDto);
      await expect(
        service.update(owner, id, { countryCodes: ['ZZ'] }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'countryCodes' }] },
      });
      expect((await model.findById(id).lean())?.countryCodes).toEqual([
        'EG',
        'AE',
      ]);
    });
  });

  describe('days (ITN-05)', () => {
    /** Stores `count` days directly, to reach the limit without 60 requests. */
    const fillDays = (id: string, count: number) =>
      model.updateOne(
        { _id: id },
        {
          $set: {
            days: Array.from({ length: count }, () => ({
              _id: new Types.ObjectId(),
              cityId: 'cairo',
              notes: '',
            })),
          },
        },
      );
    const storedDayCount = async (id: string) =>
      (await model.findById(id).lean())?.days?.length;

    it('adds days at the end, numbered from 1 and dated from the start date', async () => {
      const { id } = await service.create(owner, validDto);

      const first = await service.addDay(owner, id, { cityId: 'cairo' });
      const second = await service.addDay(owner, id, {
        cityId: 'luxor',
        notes: 'Valley of the Kings',
      });
      const third = await service.addDay(owner, id, { cityId: 'dubai' });

      expect(first).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        dayNumber: 1,
        date: '2026-12-20',
        cityId: 'cairo',
        notes: '',
      });
      expect(second).toMatchObject({
        dayNumber: 2,
        date: '2026-12-21',
        notes: 'Valley of the Kings',
      });
      expect(third).toMatchObject({ dayNumber: 3, date: '2026-12-22' });
      expect((await service.findMine(owner, id)).days).toEqual([
        first,
        second,
        third,
      ]);
    });

    it('derives dates across a month and a year end', async () => {
      const { id } = await service.create(owner, {
        ...validDto,
        startDate: '2026-12-30',
      });
      for (let i = 0; i < 3; i++) {
        await service.addDay(owner, id, { cityId: 'cairo' });
      }
      const { days } = await service.findMine(owner, id);
      expect(days.map((day) => day.date)).toEqual([
        '2026-12-30',
        '2026-12-31',
        '2027-01-01',
      ]);
    });

    it('moves every day date when the start date changes', async () => {
      const { id } = await service.create(owner, validDto);
      await service.addDay(owner, id, { cityId: 'cairo' });
      await service.addDay(owner, id, { cityId: 'luxor' });

      const updated = await service.update(owner, id, {
        startDate: '2027-02-27',
      });

      expect(updated.days.map((day) => [day.dayNumber, day.date])).toEqual([
        [1, '2027-02-27'],
        [2, '2027-02-28'],
      ]);
    });

    it('rejects a city that is not in the seeded list with 400 and saves nothing', async () => {
      const { id } = await service.create(owner, validDto);
      await expect(
        service.addDay(owner, id, { cityId: 'atlantis' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'cityId' }] },
      });
      expect(await storedDayCount(id)).toBe(0);
    });

    it("answers 404 for someone else's itinerary or an unknown one, and saves nothing", async () => {
      const { id } = await service.create(owner, validDto);
      await expect(
        service.addDay(stranger, id, { cityId: 'cairo' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.addDay(owner, new Types.ObjectId().toString(), {
          cityId: 'cairo',
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await storedDayCount(id)).toBe(0);
    });

    it('accepts the 60th day and rejects the 61st with 400', async () => {
      const { id } = await service.create(owner, validDto);
      await fillDays(id, 59);

      await expect(
        service.addDay(owner, id, { cityId: 'cairo' }),
      ).resolves.toMatchObject({ dayNumber: 60, date: '2027-02-17' });
      await expect(
        service.addDay(owner, id, { cityId: 'cairo' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'days' }] },
      });
      expect(await storedDayCount(id)).toBe(60);
    });

    it('lets only one of several simultaneous requests add the 60th day', async () => {
      const { id } = await service.create(owner, validDto);
      await fillDays(id, 59);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          service.addDay(owner, id, { cityId: 'cairo' }),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await storedDayCount(id)).toBe(60);
    });

    it('edits one day: city and notes change, number and date stay, other days untouched', async () => {
      const { id } = await service.create(owner, validDto);
      const first = await service.addDay(owner, id, { cityId: 'cairo' });
      const second = await service.addDay(owner, id, { cityId: 'cairo' });

      const edited = await service.updateDay(owner, id, second.id, {
        cityId: 'dubai',
        notes: 'Desert safari',
      });

      expect(edited).toEqual({
        ...second,
        cityId: 'dubai',
        notes: 'Desert safari',
      });
      expect((await service.findMine(owner, id)).days).toEqual([first, edited]);
    });

    it('changes only the field that was sent', async () => {
      const { id } = await service.create(owner, validDto);
      const day = await service.addDay(owner, id, {
        cityId: 'cairo',
        notes: 'Museum',
      });
      await expect(
        service.updateDay(owner, id, day.id, { notes: 'Khan el-Khalili' }),
      ).resolves.toMatchObject({ cityId: 'cairo', notes: 'Khan el-Khalili' });
    });

    it('rejects an edit with an unknown city or an empty body (400) and keeps the day', async () => {
      const { id } = await service.create(owner, validDto);
      const day = await service.addDay(owner, id, { cityId: 'cairo' });
      await expect(
        service.updateDay(owner, id, day.id, { cityId: 'atlantis' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'cityId' }] },
      });
      await expect(
        service.updateDay(owner, id, day.id, {}),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'body' }] },
      });
      expect((await service.findMine(owner, id)).days[0].cityId).toBe('cairo');
    });

    it("answers 404 when editing someone else's day, an unknown day, or a day of another itinerary", async () => {
      const { id } = await service.create(owner, validDto);
      const day = await service.addDay(owner, id, { cityId: 'cairo' });
      const other = await service.create(owner, validDto);

      await expect(
        service.updateDay(stranger, id, day.id, { notes: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.updateDay(owner, id, new Types.ObjectId().toString(), {
          notes: 'x',
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.updateDay(owner, other.id, day.id, { notes: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
      expect((await service.findMine(owner, id)).days[0].notes).toBe('');
    });

    it('shows the real day count in the list (ITN-03)', async () => {
      const { id } = await service.create(owner, validDto);
      await service.addDay(owner, id, { cityId: 'cairo' });
      await service.addDay(owner, id, { cityId: 'luxor' });
      const list = await service.listMine(owner, { page: 1, limit: 10 });
      expect(list.items[0]).toMatchObject({ id, dayCount: 2 });
    });
  });

  describe('reorder days (ITN-08)', () => {
    /** An itinerary with four days: cairo, luxor, dubai, cairo, each with its own notes. */
    const withFourDays = async () => {
      const { id } = await service.create(owner, validDto);
      const days = [];
      for (const [cityId, notes] of [
        ['cairo', 'arrive'],
        ['luxor', 'Karnak'],
        ['dubai', 'Burj'],
        ['cairo', 'fly home'],
      ]) {
        days.push(await service.addDay(owner, id, { cityId, notes }));
      }
      return { id, days };
    };
    const order = async (id: string) =>
      (await service.findMine(owner, id)).days.map((day) => day.id);

    it('moves a day up: it takes the new position, the others shift down, numbers and dates follow', async () => {
      const { id, days } = await withFourDays();

      const result = await service.reorderDay(owner, id, {
        dayId: days[2].id,
        position: 1,
      });

      expect(result.days.map((day) => day.id)).toEqual([
        days[2].id,
        days[0].id,
        days[1].id,
        days[3].id,
      ]);
      expect(result.days.map((day) => [day.dayNumber, day.date])).toEqual([
        [1, '2026-12-20'],
        [2, '2026-12-21'],
        [3, '2026-12-22'],
        [4, '2026-12-23'],
      ]);
      expect(await order(id)).toEqual(result.days.map((day) => day.id));
    });

    it('moves a day down, to the last position', async () => {
      const { id, days } = await withFourDays();

      await service.reorderDay(owner, id, { dayId: days[0].id, position: 4 });

      expect(await order(id)).toEqual([
        days[1].id,
        days[2].id,
        days[3].id,
        days[0].id,
      ]);
    });

    it('keeps each moved day city and notes, and changes nothing but the order', async () => {
      const { id, days } = await withFourDays();

      await service.reorderDay(owner, id, { dayId: days[1].id, position: 3 });

      const after = (await service.findMine(owner, id)).days;
      const byId = new Map(after.map((day) => [day.id, day]));
      for (const day of days) {
        expect(byId.get(day.id)).toMatchObject({
          cityId: day.cityId,
          notes: day.notes,
        });
      }
      expect(after).toHaveLength(4);
    });

    it("accepts the day's own position as a move that changes nothing", async () => {
      const { id, days } = await withFourDays();
      await service.reorderDay(owner, id, { dayId: days[1].id, position: 2 });
      expect(await order(id)).toEqual(days.map((day) => day.id));
    });

    it('rejects a position after the last day with 400 and keeps the order', async () => {
      const { id, days } = await withFourDays();

      await expect(
        service.reorderDay(owner, id, { dayId: days[0].id, position: 5 }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'position' }] },
      });
      expect(await order(id)).toEqual(days.map((day) => day.id));
    });

    it("answers 404 for someone else's itinerary, an unknown day or a day of another itinerary, and keeps the order", async () => {
      const { id, days } = await withFourDays();
      const other = await service.create(owner, validDto);

      await expect(
        service.reorderDay(stranger, id, { dayId: days[0].id, position: 2 }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.reorderDay(owner, id, {
          dayId: new Types.ObjectId().toString(),
          position: 2,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.reorderDay(owner, other.id, {
          dayId: days[0].id,
          position: 1,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await order(id)).toEqual(days.map((day) => day.id));
    });

    it('never loses or duplicates a day when several moves run at once', async () => {
      const { id, days } = await withFourDays();

      await Promise.all(
        days.map((day, index) =>
          service.reorderDay(owner, id, {
            dayId: day.id,
            position: days.length - index,
          }),
        ),
      );

      expect([...(await order(id))].sort()).toEqual(
        days.map((day) => day.id).sort(),
      );
    });
  });

  describe('remove', () => {
    it('lets the owner delete it', async () => {
      const { id } = await service.create(owner, validDto);
      await expect(service.remove(owner, id)).resolves.toBeUndefined();
      expect(await model.findById(id)).toBeNull();
    });

    it("answers 404 for someone else's itinerary and keeps it", async () => {
      const { id } = await service.create(owner, validDto);
      await expect(service.remove(stranger, id)).rejects.toMatchObject({
        status: 404,
      });
      expect(await model.findById(id)).not.toBeNull();
    });

    it('answers 404 when it is already gone', async () => {
      const { id } = await service.create(owner, validDto);
      await service.remove(owner, id);
      await expect(service.remove(owner, id)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('removes it from public search and leaves a clone made by another user untouched', async () => {
      const { id } = await service.create(owner, validDto);
      await model.updateOne({ _id: id }, { visibility: Visibility.PUBLIC });
      // A clone (ITN-21) is an independent copy: own id, own author, private.
      const clone = await model.create({
        authorId: new Types.ObjectId(stranger.userId),
        ...validDto,
      });

      await service.remove(owner, id);

      expect(
        await model.countDocuments({ visibility: Visibility.PUBLIC }),
      ).toBe(0);
      const kept = await model.findById(clone._id).lean();
      expect(kept).toMatchObject({
        title: validDto.title,
        authorId: new Types.ObjectId(stranger.userId),
      });
    });
  });
});
