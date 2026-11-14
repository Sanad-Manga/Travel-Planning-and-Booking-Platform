import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Collection, Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser, Role, Visibility } from '../common';
import { ActivitiesService } from './activities.service';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { Itinerary } from './schemas/itinerary.schema';

jest.setTimeout(60000);

describe('Public search and read-only view (ITN-21) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let model: Model<Itinerary>;
  let service: ItinerariesService;
  let activities: ActivitiesService;
  let users: Collection;

  const userWithId = (): AuthenticatedUser => ({
    userId: new Types.ObjectId().toString(),
    role: Role.USER,
  });
  const author = userWithId();
  const other = userWithId();
  const firstPage = { page: 1, limit: 10 };

  /** The account as UsersService reads it: a name and a status. */
  const setAccount = (user: AuthenticatedUser, name: string, status: string) =>
    users.updateOne(
      { _id: new Types.ObjectId(user.userId) },
      {
        $set: { name, status },
        $setOnInsert: { email: `${user.userId}@example.com` },
      },
      { upsert: true },
    );

  /** A public itinerary with one day in each of `cities`. */
  const createPublic = async (
    by: AuthenticatedUser,
    title: string,
    options: { countryCodes?: string[]; cities?: string[] } = {},
  ) => {
    const { id } = await service.create(by, {
      title,
      countryCodes: options.countryCodes ?? ['EG'],
      startDate: '2026-12-20',
    });
    for (const cityId of options.cities ?? []) {
      await service.addDay(by, id, { cityId });
    }
    await service.update(by, id, { visibility: Visibility.PUBLIC });
    return id;
  };
  const titles = async (query: object) =>
    (await service.searchPublic({ ...firstPage, ...query })).items.map(
      (row) => row.title,
    );

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'itn21_public_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), ItinerariesModule],
    }).compile();
    await moduleRef.init();
    model = moduleRef.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    service = moduleRef.get(ItinerariesService);
    activities = moduleRef.get(ActivitiesService);
    await model.init();

    const connection = moduleRef.get<Connection>(getConnectionToken());
    users = connection.collection('users');
    await connection.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
      { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
    ]);
    await connection.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'luxor', name: 'Luxor', country_code: 'EG' },
      { city_id: 'dubai', name: 'Dubai', country_code: 'AE' },
      { city_id: 'london', name: 'London', country_code: 'GB' },
    ]);
  });

  beforeEach(async () => {
    await model.deleteMany({});
    await setAccount(author, 'Alice Author', 'ACTIVE');
    await setAccount(other, 'Bob Other', 'ACTIVE');
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  describe('searchPublic: keyword', () => {
    it('matches the title, ignoring case, anywhere in it', async () => {
      await createPublic(author, 'Two weeks on the Nile');
      await createPublic(author, 'Weekend in Paris');

      expect(await titles({ q: 'NILE' })).toEqual(['Two weeks on the Nile']);
      expect(await titles({ q: 'end in' })).toEqual(['Weekend in Paris']);
    });

    it('matches the name of one of its countries', async () => {
      await createPublic(author, 'Desert trip', { countryCodes: ['EG'] });
      await createPublic(author, 'Gulf trip', { countryCodes: ['AE'] });

      expect(await titles({ q: 'egypt' })).toEqual(['Desert trip']);
      expect(await titles({ q: 'emirates' })).toEqual(['Gulf trip']);
    });

    it('matches the name of a city it visits', async () => {
      await createPublic(author, 'Nile cruise', { cities: ['cairo', 'luxor'] });
      await createPublic(author, 'Gulf stop', {
        countryCodes: ['AE'],
        cities: ['dubai'],
      });

      expect(await titles({ q: 'luxor' })).toEqual(['Nile cruise']);
      expect(await titles({ q: 'DUB' })).toEqual(['Gulf stop']);
    });

    it('treats the keyword as plain text, not as a pattern', async () => {
      await createPublic(author, 'Trip (2026)');
      await createPublic(author, 'Another trip');

      expect(await titles({ q: '.' })).toEqual([]);
      expect(await titles({ q: '(2026)' })).toEqual(['Trip (2026)']);
      expect(await titles({ q: '(' })).toEqual(['Trip (2026)']);
    });

    it('returns everything for an empty keyword', async () => {
      await createPublic(author, 'One');
      await createPublic(author, 'Two');
      expect(await titles({ q: '' })).toHaveLength(2);
    });
  });

  describe('searchPublic: duration and place filters', () => {
    beforeEach(async () => {
      await createPublic(author, 'Short', { cities: ['cairo'] });
      await createPublic(author, 'Medium', {
        cities: ['cairo', 'luxor', 'cairo'],
      });
      await createPublic(author, 'Long', {
        countryCodes: ['EG', 'AE'],
        cities: ['cairo', 'luxor', 'cairo', 'dubai', 'dubai'],
      });
    });

    it('keeps itineraries with at least minDays days', async () => {
      expect((await titles({ minDays: 2 })).sort()).toEqual(['Long', 'Medium']);
    });

    it('keeps itineraries with at most maxDays days', async () => {
      expect((await titles({ maxDays: 3 })).sort()).toEqual([
        'Medium',
        'Short',
      ]);
    });

    it('keeps itineraries between minDays and maxDays, both ends included', async () => {
      expect(await titles({ minDays: 3, maxDays: 3 })).toEqual(['Medium']);
      expect((await titles({ minDays: 1, maxDays: 5 })).sort()).toEqual([
        'Long',
        'Medium',
        'Short',
      ]);
    });

    it('filters by country code and by city id', async () => {
      expect(await titles({ countryCode: 'AE' })).toEqual(['Long']);
      expect((await titles({ cityId: 'luxor' })).sort()).toEqual([
        'Long',
        'Medium',
      ]);
      expect(await titles({ cityId: 'dubai' })).toEqual(['Long']);
    });

    it('combines the keyword, the duration and the place filters', async () => {
      // "o" is in the city names Cairo and Luxor, so both longer trips match the keyword and the city filter.
      expect(
        (await titles({ q: 'o', minDays: 2, cityId: 'luxor' })).sort(),
      ).toEqual(['Long', 'Medium']);
      expect(await titles({ q: 'Medium', minDays: 4 })).toEqual([]);
      expect(
        await titles({ q: 'Long', minDays: 5, countryCode: 'AE' }),
      ).toEqual(['Long']);
      expect(await titles({ q: 'Long', maxDays: 4 })).toEqual([]);
    });

    it('counts only the matches and paginates them', async () => {
      const page1 = await service.searchPublic({
        page: 1,
        limit: 1,
        minDays: 2,
      });
      const page2 = await service.searchPublic({
        page: 2,
        limit: 1,
        minDays: 2,
      });

      expect(page1).toMatchObject({ total: 2, totalPages: 2, limit: 1 });
      expect(page1.items).toHaveLength(1);
      expect(page2.items).toHaveLength(1);
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    });

    it('rejects a minimum above the maximum with 400, naming the field', async () => {
      await expect(
        service.searchPublic({ ...firstPage, minDays: 5, maxDays: 2 }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'minDays' }] },
      });
    });

    it('shows the number of days on every row', async () => {
      const result = await service.searchPublic({ ...firstPage, q: 'Long' });
      expect(result.items[0]).toMatchObject({ title: 'Long', dayCount: 5 });
    });
  });

  describe('searchPublic: what never shows up', () => {
    it('never lists a private itinerary, a hidden one or one of a suspended or deactivated author, whatever the filters', async () => {
      const shown = await createPublic(author, 'Nile shown', {
        cities: ['cairo'],
      });
      const privateOne = await createPublic(author, 'Nile private', {
        cities: ['cairo'],
      });
      await service.update(author, privateOne, {
        visibility: Visibility.PRIVATE,
      });
      const hidden = await createPublic(author, 'Nile hidden', {
        cities: ['cairo'],
      });
      await model.updateOne({ _id: hidden }, { isHidden: true });
      await createPublic(other, 'Nile suspended author', { cities: ['cairo'] });
      await setAccount(other, 'Bob Other', 'SUSPENDED');

      const filters = { q: 'nile', minDays: 1, maxDays: 60, cityId: 'cairo' };
      const result = await service.searchPublic({ ...firstPage, ...filters });

      expect(result.items.map((row) => row.id)).toEqual([shown]);
      expect(result.total).toBe(1);
    });
  });

  describe('findPublic', () => {
    it('shows a public itinerary read-only: author name, days and their activities', async () => {
      const id = await createPublic(author, 'Nile cruise', {
        cities: ['cairo', 'luxor'],
      });
      const { days } = await service.findMine(author, id);
      await activities.create(author, id, days[0].id, {
        name: 'Pyramids',
        time: '08:30',
        costCents: 3500,
      });

      const view = await service.findPublic(id);

      expect(view).toMatchObject({
        id,
        title: 'Nile cruise',
        countryCodes: ['EG'],
        startDate: '2026-12-20',
        author: { id: author.userId, name: 'Alice Author' },
      });
      expect(view.days).toHaveLength(2);
      expect(view.days[0]).toMatchObject({
        dayNumber: 1,
        date: '2026-12-20',
        cityId: 'cairo',
        activities: [
          expect.objectContaining({
            name: 'Pyramids',
            time: '08:30',
            costCents: 3500,
          }),
        ],
      });
      expect(view.days[1].activities).toEqual([]);
    });

    it('does not expose anything an edit screen would need', async () => {
      const id = await createPublic(author, 'Nile cruise', {
        cities: ['cairo'],
      });
      const view = await service.findPublic(id);
      expect(view).not.toHaveProperty('authorId');
      expect(view).not.toHaveProperty('isHidden');
      expect(view).not.toHaveProperty('visibility');
      expect(view.author).toEqual({
        id: author.userId,
        name: 'Alice Author',
      });
    });

    it('answers 404 for a private itinerary, a hidden one, one of a suspended author and an unknown id', async () => {
      const privateId = (
        await service.create(author, {
          title: 'Private',
          countryCodes: ['EG'],
          startDate: '2026-12-20',
        })
      ).id;
      const hiddenId = await createPublic(author, 'Hidden');
      await model.updateOne({ _id: hiddenId }, { isHidden: true });
      const suspendedId = await createPublic(other, 'Suspended');
      await setAccount(other, 'Bob Other', 'SUSPENDED');

      for (const id of [
        privateId,
        hiddenId,
        suspendedId,
        new Types.ObjectId().toString(),
      ]) {
        await expect(service.findPublic(id)).rejects.toMatchObject({
          status: 404,
        });
      }
    });

    it('stops showing an itinerary the moment it is made private', async () => {
      const id = await createPublic(author, 'Nile cruise');
      await expect(service.findPublic(id)).resolves.toMatchObject({ id });

      await service.update(author, id, { visibility: Visibility.PRIVATE });

      await expect(service.findPublic(id)).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
