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
import { BudgetsService } from './budgets.service';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { BudgetCategory } from './schemas/budget.schema';
import { Itinerary } from './schemas/itinerary.schema';
import { TransportMode } from './schemas/transport-cost.schema';
import { TransportCostsService } from './transport-costs.service';

jest.setTimeout(60000);

describe('Clone a public itinerary (ITN-21) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let connection: Connection;
  let model: Model<Itinerary>;
  let service: ItinerariesService;
  let activities: ActivitiesService;
  let budgets: BudgetsService;
  let transportCosts: TransportCostsService;
  let users: Collection;

  const userWithId = (): AuthenticatedUser => ({
    userId: new Types.ObjectId().toString(),
    role: Role.USER,
  });
  const author = userWithId();
  const reader = userWithId();

  const setAccount = (user: AuthenticatedUser, name: string, status: string) =>
    users.updateOne(
      { _id: new Types.ObjectId(user.userId) },
      {
        $set: { name, status },
        $setOnInsert: { email: `${user.userId}@example.com` },
      },
      { upsert: true },
    );

  /**
   * A public itinerary with two days (Cairo, Luxor) and one of everything that belongs to it: two activities, a
   * daily budget entry and an intercity transport cost.
   */
  const publicWithPlan = async () => {
    const { id } = await service.create(author, {
      title: 'Nile cruise',
      countryCodes: ['EG'],
      startDate: '2026-12-20',
    });
    await service.addDay(author, id, { cityId: 'cairo', notes: 'Arrive' });
    await service.addDay(author, id, { cityId: 'luxor' });
    await service.update(author, id, { visibility: Visibility.PUBLIC });
    const { days } = await service.findMine(author, id);
    await activities.create(author, id, days[0].id, {
      name: 'Pyramids',
      description: 'Giza plateau',
      time: '08:30',
      costCents: 3500,
    });
    await activities.create(author, id, days[1].id, { name: 'Karnak' });
    await budgets.create(author, id, days[0].id, {
      category: BudgetCategory.FOOD,
      amountCents: 2500,
      currency: 'EGP',
    });
    await transportCosts.create(author, id, {
      dayId: days[1].id,
      mode: TransportMode.TRAIN,
      fromCityId: 'cairo',
      toCityId: 'luxor',
      amountCents: 4000,
      currency: 'EGP',
    });
    return { id, days };
  };
  const countRows = async () => ({
    itineraries: await connection.collection('itineraries').countDocuments(),
    activities: await connection.collection('activities').countDocuments(),
    budgets: await connection.collection('budgets').countDocuments(),
    transportCosts: await connection
      .collection('transportCosts')
      .countDocuments(),
  });

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'itn21_clone_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), ItinerariesModule],
    }).compile();
    await moduleRef.init();
    model = moduleRef.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    service = moduleRef.get(ItinerariesService);
    activities = moduleRef.get(ActivitiesService);
    budgets = moduleRef.get(BudgetsService);
    transportCosts = moduleRef.get(TransportCostsService);
    await model.init();

    connection = moduleRef.get<Connection>(getConnectionToken());
    users = connection.collection('users');
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
    for (const name of [
      'itineraries',
      'activities',
      'budgets',
      'transportCosts',
    ]) {
      await connection.collection(name).deleteMany({});
    }
    await setAccount(author, 'Alice Author', 'ACTIVE');
    await setAccount(reader, 'Bob Reader', 'ACTIVE');
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  describe('the copy', () => {
    it('is a new private itinerary owned by the caller, with the same title, countries and start date', async () => {
      const { id } = await publicWithPlan();

      const clone = await service.clone(reader, id);

      expect(clone.id).not.toBe(id);
      expect(clone).toMatchObject({
        authorId: reader.userId,
        title: 'Nile cruise',
        countryCodes: ['EG'],
        startDate: '2026-12-20',
        visibility: Visibility.PRIVATE,
        isHidden: false,
      });
      // it is the caller's: listed in their own itineraries, openable by them, not by the author
      await expect(service.findMine(reader, clone.id)).resolves.toMatchObject({
        id: clone.id,
      });
      await expect(service.findMine(author, clone.id)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('credits the original author and the itinerary it came from', async () => {
      const { id } = await publicWithPlan();

      const clone = await service.clone(reader, id);

      expect(clone.clonedFrom).toEqual({
        itineraryId: id,
        authorId: author.userId,
        authorName: 'Alice Author',
      });
      // the credit is kept when the clone is opened again
      const reopened = await service.findMine(reader, clone.id);
      expect(reopened.clonedFrom).toEqual(clone.clonedFrom);
    });

    it('has no credit on an itinerary that is not a clone', async () => {
      const { id } = await publicWithPlan();
      const original = await service.findMine(author, id);
      expect(original.clonedFrom).toBeNull();
    });

    it('keeps the credit when the clone is made public: readers see who made the original', async () => {
      const { id } = await publicWithPlan();
      const clone = await service.clone(reader, id);
      await service.update(reader, clone.id, { visibility: Visibility.PUBLIC });

      const view = await service.findPublic(clone.id);

      expect(view.author).toEqual({ id: reader.userId, name: 'Bob Reader' });
      expect(view.clonedFrom).toEqual({
        itineraryId: id,
        authorId: author.userId,
        authorName: 'Alice Author',
      });
    });

    it('copies every day with its city and notes, in order, with new ids', async () => {
      const { id, days } = await publicWithPlan();

      const clone = await service.clone(reader, id);

      expect(clone.days.map((d) => [d.cityId, d.notes, d.dayNumber])).toEqual([
        ['cairo', 'Arrive', 1],
        ['luxor', '', 2],
      ]);
      expect(clone.days.map((d) => d.date)).toEqual([
        '2026-12-20',
        '2026-12-21',
      ]);
      const originalIds = days.map((d) => d.id);
      for (const day of clone.days) expect(originalIds).not.toContain(day.id);
    });

    it('copies every activity onto the matching day, with new ids and no images', async () => {
      const { id } = await publicWithPlan();
      // an image on the original: the file belongs to the original activity and is not shared
      await connection
        .collection('activities')
        .updateOne(
          { name: 'Pyramids' },
          { $set: { images: [{ id: 'img-1', url: '/uploads/img-1.png' }] } },
        );

      const clone = await service.clone(reader, id);

      const [first, second] = clone.days;
      expect(first.activities).toEqual([
        expect.objectContaining({
          name: 'Pyramids',
          description: 'Giza plateau',
          time: '08:30',
          costCents: 3500,
          itineraryId: clone.id,
          dayId: first.id,
          images: [],
        }),
      ]);
      expect(second.activities).toEqual([
        expect.objectContaining({
          name: 'Karnak',
          time: null,
          costCents: null,
          dayId: second.id,
        }),
      ]);
      const original = await service.findMine(author, id);
      expect(original.days[0].activities[0].images).toEqual([
        { id: 'img-1', url: '/uploads/img-1.png' },
      ]);
      expect(first.activities[0].id).not.toBe(
        original.days[0].activities[0].id,
      );
    });

    it('copies every budget entry and transport cost onto the matching new day', async () => {
      const { id } = await publicWithPlan();

      const clone = await service.clone(reader, id);

      expect(clone.budgets).toEqual([
        expect.objectContaining({
          itineraryId: clone.id,
          dayId: clone.days[0].id,
          category: 'FOOD',
          amountCents: 2500,
          currency: 'EGP',
        }),
      ]);
      expect(clone.transportCosts).toEqual([
        expect.objectContaining({
          itineraryId: clone.id,
          dayId: clone.days[1].id,
          mode: 'TRAIN',
          fromCityId: 'cairo',
          toCityId: 'luxor',
          amountCents: 4000,
          currency: 'EGP',
        }),
      ]);
    });

    it('has the same budget totals as the original', async () => {
      const { id } = await publicWithPlan();
      const clone = await service.clone(reader, id);

      const totalsOf = async (user: AuthenticatedUser, itineraryId: string) =>
        (await budgets.summary(user, itineraryId)).totals.map((block) => ({
          currency: block.currency,
          totalCents: block.totalCents,
          byCategory: block.byCategory,
          byDay: block.byDay.map((d) => d.totalCents),
        }));

      expect(await totalsOf(reader, clone.id)).toEqual(
        await totalsOf(author, id),
      );
      expect(await totalsOf(reader, clone.id)).not.toEqual([]);
    });

    it('does not copy costs of a day that is no longer in the original', async () => {
      const { id } = await publicWithPlan();
      // a leftover row of a deleted day (the rows are normally deleted with the day)
      await connection.collection('activities').insertOne({
        itineraryId: new Types.ObjectId(id),
        dayId: new Types.ObjectId(),
        ownerId: new Types.ObjectId(author.userId),
        name: 'Orphan',
        description: '',
        images: [],
      });

      const clone = await service.clone(reader, id);

      const names = clone.days.flatMap((d) => d.activities.map((a) => a.name));
      expect(names.sort()).toEqual(['Karnak', 'Pyramids']);
    });

    it('can copy an itinerary without days or costs', async () => {
      const { id } = await service.create(author, {
        title: 'Empty',
        countryCodes: ['EG'],
        startDate: '2026-12-20',
      });
      await service.update(author, id, { visibility: Visibility.PUBLIC });

      const clone = await service.clone(reader, id);

      expect(clone).toMatchObject({
        title: 'Empty',
        days: [],
        budgets: [],
        transportCosts: [],
      });
    });

    it('lets the author copy their own public itinerary', async () => {
      const { id } = await publicWithPlan();
      const clone = await service.clone(author, id);
      expect(clone.id).not.toBe(id);
      expect(clone.authorId).toBe(author.userId);
      expect(clone.visibility).toBe(Visibility.PRIVATE);
    });

    it('makes two independent copies when cloned twice', async () => {
      const { id } = await publicWithPlan();
      const first = await service.clone(reader, id);
      const second = await service.clone(reader, id);
      expect(first.id).not.toBe(second.id);
      expect(first.days[0].id).not.toBe(second.days[0].id);
    });
  });

  describe('independent of the original', () => {
    it('editing the clone changes nothing in the original', async () => {
      const { id, days } = await publicWithPlan();
      const clone = await service.clone(reader, id);
      const before = await service.findMine(author, id);

      await service.update(reader, clone.id, {
        title: 'My version',
        visibility: Visibility.PUBLIC,
      });
      await service.updateDay(reader, clone.id, clone.days[0].id, {
        cityId: 'dubai',
        notes: 'Changed',
      });
      await activities.update(reader, clone.days[0].activities[0].id, {
        name: 'Changed',
        costCents: 1,
      });
      await activities.create(reader, clone.id, clone.days[0].id, {
        name: 'New one',
      });
      await budgets.update(reader, clone.budgets[0].id, { amountCents: 1 });
      await transportCosts.update(reader, clone.transportCosts[0].id, {
        amountCents: 1,
      });
      await service.removeDay(reader, clone.id, clone.days[1].id);

      const after = await service.findMine(author, id);
      expect(after).toEqual(before);
      expect(after.days.map((d) => d.id)).toEqual(days.map((d) => d.id));
    });

    it('editing the original changes nothing in the clone', async () => {
      const { id, days } = await publicWithPlan();
      const clone = await service.clone(reader, id);
      const before = await service.findMine(reader, clone.id);
      const original = await service.findMine(author, id);

      await service.update(author, id, { title: 'Renamed' });
      await activities.update(author, original.days[0].activities[0].id, {
        name: 'Renamed activity',
      });
      await budgets.update(author, original.budgets[0].id, { amountCents: 1 });
      await service.removeDay(author, id, days[0].id);

      expect(await service.findMine(reader, clone.id)).toEqual(before);
    });

    it('deleting the original keeps the clone with all its days, activities and budgets', async () => {
      const { id } = await publicWithPlan();
      const clone = await service.clone(reader, id);
      const before = await service.findMine(reader, clone.id);

      await service.remove(author, id);

      expect(await service.findMine(reader, clone.id)).toEqual(before);
      expect(before.days).toHaveLength(2);
      expect(before.budgets).toHaveLength(1);
      expect(before.transportCosts).toHaveLength(1);
    });

    it('deleting the clone keeps the original with all of its rows', async () => {
      const { id } = await publicWithPlan();
      const before = await service.findMine(author, id);
      const clone = await service.clone(reader, id);

      await service.remove(reader, clone.id);

      expect(await service.findMine(author, id)).toEqual(before);
    });
  });

  describe('what can be cloned', () => {
    it('answers 404 for a private itinerary, a hidden one, one of a suspended author and an unknown id, and creates nothing', async () => {
      const privateOne = await publicWithPlan();
      await service.update(author, privateOne.id, {
        visibility: Visibility.PRIVATE,
      });
      const hiddenOne = await publicWithPlan();
      await model.updateOne({ _id: hiddenOne.id }, { isHidden: true });
      const suspended = userWithId();
      await setAccount(suspended, 'Sam Suspended', 'ACTIVE');
      const { id: suspendedId } = await service.create(suspended, {
        title: 'Suspended',
        countryCodes: ['EG'],
        startDate: '2026-12-20',
      });
      await service.update(suspended, suspendedId, {
        visibility: Visibility.PUBLIC,
      });
      await setAccount(suspended, 'Sam Suspended', 'SUSPENDED');
      const before = await countRows();

      for (const id of [
        privateOne.id,
        hiddenOne.id,
        suspendedId,
        new Types.ObjectId().toString(),
      ]) {
        await expect(service.clone(reader, id)).rejects.toMatchObject({
          status: 404,
        });
      }

      expect(await countRows()).toEqual(before);
    });
  });

  describe('parallel clones and a failing copy', () => {
    it('gives every one of several simultaneous clones its own full set of rows', async () => {
      const { id } = await publicWithPlan();

      const copies = await Promise.all(
        [reader, reader, author, reader].map((user) => service.clone(user, id)),
      );

      expect(new Set(copies.map((copy) => copy.id)).size).toBe(4);
      for (const copy of copies) {
        expect(copy.days).toHaveLength(2);
        expect(copy.days.flatMap((d) => d.activities)).toHaveLength(2);
        expect(copy.budgets).toHaveLength(1);
        expect(copy.transportCosts).toHaveLength(1);
      }
      expect(await countRows()).toEqual({
        itineraries: 5,
        activities: 10,
        budgets: 5,
        transportCosts: 5,
      });
    });

    it('leaves nothing behind when copying the rows fails, and the original is untouched', async () => {
      const { id } = await publicWithPlan();
      const before = await countRows();
      const original = await service.findMine(author, id);
      const failing = jest
        .spyOn(budgets, 'copyForClone')
        .mockRejectedValueOnce(new Error('disk full'));

      await expect(service.clone(reader, id)).rejects.toThrow('disk full');

      failing.mockRestore();
      expect(await countRows()).toEqual(before);
      expect(await service.findMine(author, id)).toEqual(original);
      // and the same clone works once the failure is gone
      await expect(service.clone(reader, id)).resolves.toMatchObject({
        title: 'Nile cruise',
      });
    });
  });

  describe('public view with the budget', () => {
    it('shows the budget totals of the itinerary: platform currency first, other currencies as their own blocks', async () => {
      const { id } = await publicWithPlan();

      const view = await service.findPublic(id);

      expect(view.budget.itineraryId).toBe(id);
      expect(view.budget.platformCurrency).toMatch(/^[A-Z]{3}$/);
      // 3500 for the Pyramids (platform currency), 2500 food and 4000 train in EGP
      expect(
        view.budget.totals.map((block) => [block.currency, block.totalCents]),
      ).toEqual([
        [view.budget.platformCurrency, 3500],
        ['EGP', 6500],
      ]);
      expect(view.budget.totals[0].byDay).toHaveLength(2);
    });

    it('has an empty list of totals when nothing costs money', async () => {
      const { id } = await service.create(author, {
        title: 'Free',
        countryCodes: ['EG'],
        startDate: '2026-12-20',
      });
      await service.update(author, id, { visibility: Visibility.PUBLIC });
      expect((await service.findPublic(id)).budget.totals).toEqual([]);
    });
  });
});
