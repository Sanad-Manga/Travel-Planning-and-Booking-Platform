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
import { BudgetsService } from './budgets.service';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { Budget, BudgetCategory } from './schemas/budget.schema';
import { TransportMode } from './schemas/transport-cost.schema';
import { TransportCostsService } from './transport-costs.service';

jest.setTimeout(60000);

describe('BudgetsService (ITN-14) with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let budgets: BudgetsService;
  let itineraries: ItinerariesService;
  let activities: ActivitiesService;
  let transport: TransportCostsService;
  let model: Model<Budget>;

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
  const food = (amountCents = 2500) => ({
    category: BudgetCategory.FOOD,
    amountCents,
    currency: PLATFORM_CURRENCY,
  });
  const storedCount = (itineraryId: string) =>
    model
      .countDocuments({ itineraryId: new Types.ObjectId(itineraryId) })
      .exec();

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'itn14_budgets_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), ItinerariesModule],
    }).compile();
    await moduleRef.init();
    budgets = moduleRef.get(BudgetsService);
    itineraries = moduleRef.get(ItinerariesService);
    activities = moduleRef.get(ActivitiesService);
    transport = moduleRef.get(TransportCostsService);
    model = moduleRef.get<Model<Budget>>(getModelToken(Budget.name));
    await model.init();

    const connection = moduleRef.get<Connection>(getConnectionToken());
    await connection.collection('countries').insertMany([
      { code: 'EG', name: 'Egypt', currency: 'EGP' },
      { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
    ]);
    await connection.collection('cities').insertMany([
      { city_id: 'cairo', name: 'Cairo', country_code: 'EG' },
      { city_id: 'dubai', name: 'Dubai', country_code: 'AE' },
    ]);
    await connection.collection('currencies').insertMany(
      [...new Set([PLATFORM_CURRENCY, 'EGP', 'AED'])].map((code) => ({
        code,
      })),
    );
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  describe('create', () => {
    it('adds an entry with category, amount in cents and currency to a day', async () => {
      const { id, first } = await withTwoDays();

      const created = await budgets.create(owner, id, first.id, food());

      expect(created).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        itineraryId: id,
        dayId: first.id,
        category: 'FOOD',
        amountCents: 2500,
        currency: PLATFORM_CURRENCY,
      });
      expect(await storedCount(id)).toBe(1);
    });

    it('accepts an amount of 0, every one of the four categories and another currency', async () => {
      const { id, first } = await withTwoDays();
      for (const category of Object.values(BudgetCategory)) {
        await expect(
          budgets.create(owner, id, first.id, {
            category,
            amountCents: 0,
            currency: 'EGP',
          }),
        ).resolves.toMatchObject({ category, amountCents: 0, currency: 'EGP' });
      }
      expect(Object.values(BudgetCategory)).toEqual([
        'FOOD',
        'ACCOMMODATION',
        'IN_CITY_TRANSPORT',
        'ACTIVITIES',
      ]);
    });

    it('uses the platform currency when none is sent', async () => {
      const { id, first } = await withTwoDays();
      const created = await budgets.create(owner, id, first.id, {
        category: BudgetCategory.FOOD,
        amountCents: 100,
      });
      expect(created.currency).toBe(PLATFORM_CURRENCY);
    });

    it("answers 404 for someone else's itinerary, an unknown one or a day of another itinerary, and saves nothing", async () => {
      const { id, first } = await withTwoDays();
      const other = await withTwoDays();
      await expect(
        budgets.create(stranger, id, first.id, food()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        budgets.create(
          owner,
          new Types.ObjectId().toString(),
          first.id,
          food(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        budgets.create(owner, id, other.first.id, food()),
      ).rejects.toMatchObject({ status: 404 });
      expect(await storedCount(id)).toBe(0);
    });

    it('rejects a currency that is not supported with 400, naming the field', async () => {
      const { id, first } = await withTwoDays();
      await expect(
        budgets.create(owner, id, first.id, { ...food(), currency: 'XXX' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'currency' }] },
      });
      expect(await storedCount(id)).toBe(0);
    });
  });

  describe('edit', () => {
    it('changes only the fields that were sent', async () => {
      const { id, first } = await withTwoDays();
      const created = await budgets.create(owner, id, first.id, food());

      const edited = await budgets.update(owner, created.id, {
        category: BudgetCategory.ACCOMMODATION,
        amountCents: 9000,
      });

      expect(edited).toEqual({
        ...created,
        category: 'ACCOMMODATION',
        amountCents: 9000,
      });
    });

    it('can change the currency', async () => {
      const { id, first } = await withTwoDays();
      const created = await budgets.create(owner, id, first.id, food());
      const edited = await budgets.update(owner, created.id, {
        currency: 'AED',
      });
      expect(edited.currency).toBe('AED');
    });

    it('rejects an unsupported currency or an empty edit with 400 and keeps the entry', async () => {
      const { id, first } = await withTwoDays();
      const created = await budgets.create(owner, id, first.id, food());

      await expect(
        budgets.update(owner, created.id, { currency: 'XXX' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { details: [{ field: 'currency' }] },
      });
      await expect(budgets.update(owner, created.id, {})).rejects.toMatchObject(
        {
          status: 400,
          response: { details: [{ field: 'body' }] },
        },
      );
      expect(await model.findById(created.id).lean()).toMatchObject({
        currency: PLATFORM_CURRENCY,
        amountCents: 2500,
      });
    });

    it("answers 404 for someone else's entry or an unknown one, and changes nothing", async () => {
      const { id, first } = await withTwoDays();
      const created = await budgets.create(owner, id, first.id, food());

      await expect(
        budgets.update(stranger, created.id, { amountCents: 1 }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        budgets.update(owner, new Types.ObjectId().toString(), {
          amountCents: 1,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect((await model.findById(created.id).lean())?.amountCents).toBe(2500);
    });
  });

  describe('delete', () => {
    it('removes the entry, and a second delete answers 404', async () => {
      const { id, first } = await withTwoDays();
      const created = await budgets.create(owner, id, first.id, food());

      await budgets.remove(owner, created.id);

      expect(await storedCount(id)).toBe(0);
      await expect(budgets.remove(owner, created.id)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("answers 404 for someone else's entry and keeps it", async () => {
      const { id, first } = await withTwoDays();
      const created = await budgets.create(owner, id, first.id, food());
      await expect(budgets.remove(stranger, created.id)).rejects.toMatchObject({
        status: 404,
      });
      expect(await storedCount(id)).toBe(1);
    });

    it('lets only one of several simultaneous deletes succeed', async () => {
      const { id, first } = await withTwoDays();
      const created = await budgets.create(owner, id, first.id, food());

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => budgets.remove(owner, created.id)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('shown on the itinerary and removed with it', () => {
    it('lists the entries on the itinerary, in the order they were added, [] when none', async () => {
      const { id, first, second } = await withTwoDays();
      expect((await itineraries.findMine(owner, id)).budgets).toEqual([]);
      const a = await budgets.create(owner, id, first.id, food());
      const b = await budgets.create(owner, id, second.id, food(700));

      expect((await itineraries.findMine(owner, id)).budgets).toEqual([a, b]);
    });

    it("is deleted with the itinerary and never touches another itinerary's entries", async () => {
      const { id, first } = await withTwoDays();
      const other = await withTwoDays();
      await budgets.create(owner, id, first.id, food());
      await budgets.create(owner, other.id, other.first.id, food());

      await itineraries.remove(owner, id);

      expect(await storedCount(id)).toBe(0);
      expect(await storedCount(other.id)).toBe(1);
    });

    it('is deleted with its day; the other days keep theirs', async () => {
      const { id, first, second } = await withTwoDays();
      await budgets.create(owner, id, first.id, food());
      const kept = await budgets.create(owner, id, second.id, food());

      await itineraries.removeDay(owner, id, first.id);

      expect((await itineraries.findMine(owner, id)).budgets).toEqual([kept]);
    });
  });

  describe('budget summary', () => {
    /** Day 1: food 2500 + hotel 9000 (platform currency), an activity of 3500, a flight of 25000 EGP. Day 2: food 700. */
    const filled = async () => {
      const { id, first, second } = await withTwoDays();
      await budgets.create(owner, id, first.id, food(2500));
      await budgets.create(owner, id, first.id, {
        category: BudgetCategory.ACCOMMODATION,
        amountCents: 9000,
        currency: PLATFORM_CURRENCY,
      });
      await budgets.create(owner, id, second.id, food(700));
      await activities.create(owner, id, first.id, {
        name: 'Pyramids',
        costCents: 3500,
      });
      await activities.create(owner, id, second.id, { name: 'Free walk' });
      await transport.create(owner, id, {
        mode: TransportMode.FLIGHT,
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amountCents: 25000,
        currency: 'EGP',
        dayId: first.id,
      });
      return { id, first, second };
    };

    it('shows a total by category and by day per currency, and both add up to the same grand total', async () => {
      const { id, first, second } = await filled();

      const summary = await budgets.summary(owner, id);

      expect(summary.itineraryId).toBe(id);
      expect(summary.platformCurrency).toBe(PLATFORM_CURRENCY);
      const platform = summary.totals.find(
        (t) => t.currency === PLATFORM_CURRENCY,
      );
      expect(platform).toBeDefined();
      // 2500 + 9000 + 700 budgets + 3500 activity (the platform currency)
      expect(platform?.totalCents).toBe(15700);
      expect(platform?.byCategory).toEqual([
        { category: 'FOOD', totalCents: 3200 },
        { category: 'ACCOMMODATION', totalCents: 9000 },
        { category: 'IN_CITY_TRANSPORT', totalCents: 0 },
        { category: 'ACTIVITIES', totalCents: 3500 },
        { category: 'INTERCITY_TRANSPORT', totalCents: 0 },
      ]);
      expect(platform?.byDay).toEqual([
        {
          dayId: first.id,
          dayNumber: 1,
          date: '2026-12-20',
          totalCents: 15000,
        },
        {
          dayId: second.id,
          dayNumber: 2,
          date: '2026-12-21',
          totalCents: 700,
        },
      ]);
      for (const total of summary.totals) {
        const byCategory = total.byCategory.reduce(
          (s, c) => s + c.totalCents,
          0,
        );
        const byDay = total.byDay.reduce((s, d) => s + d.totalCents, 0);
        expect(byCategory).toBe(total.totalCents);
        expect(byDay).toBe(total.totalCents);
      }
    });

    it('counts activity costs as Activities and intercity transport on its own line', async () => {
      const { id } = await filled();
      const summary = await budgets.summary(owner, id);
      const egp = summary.totals.find((t) => t.currency === 'EGP');
      expect(egp?.totalCents).toBe(25000);
      expect(egp?.byCategory).toContainEqual({
        category: 'INTERCITY_TRANSPORT',
        totalCents: 25000,
      });
      const platform = summary.totals.find(
        (t) => t.currency === PLATFORM_CURRENCY,
      );
      expect(platform?.byCategory).toContainEqual({
        category: 'ACTIVITIES',
        totalCents: 3500,
      });
    });

    it('keeps each currency apart (no conversion here) and lists the platform currency first', async () => {
      const { id } = await filled();
      const summary = await budgets.summary(owner, id);
      expect(summary.totals.map((t) => t.currency)).toEqual([
        PLATFORM_CURRENCY,
        'EGP',
      ]);
    });

    it('lists every day, with 0, even when a day has nothing', async () => {
      const { id, first, second } = await withTwoDays();
      await budgets.create(owner, id, first.id, food(100));
      const summary = await budgets.summary(owner, id);
      expect(summary.totals[0].byDay.map((d) => d.dayId)).toEqual([
        first.id,
        second.id,
      ]);
      expect(summary.totals[0].byDay[1].totalCents).toBe(0);
    });

    it('has no totals for an itinerary without any cost', async () => {
      const { id } = await withTwoDays();
      expect((await budgets.summary(owner, id)).totals).toEqual([]);
    });

    it('ignores an entry whose day no longer exists, so the two views still agree', async () => {
      const { id, first } = await withTwoDays();
      await budgets.create(owner, id, first.id, food(100));
      await model.create({
        itineraryId: new Types.ObjectId(id),
        dayId: new Types.ObjectId(),
        ownerId: new Types.ObjectId(owner.userId),
        category: BudgetCategory.FOOD,
        amountCents: 999,
        currency: PLATFORM_CURRENCY,
      });
      const total = (await budgets.summary(owner, id)).totals[0];
      expect(total.totalCents).toBe(100);
      expect(total.byDay.reduce((s, d) => s + d.totalCents, 0)).toBe(100);
    });

    it("answers 404 for someone else's or an unknown itinerary", async () => {
      const { id } = await filled();
      await expect(budgets.summary(stranger, id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        budgets.summary(owner, new Types.ObjectId().toString()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('gives each city group a subtotal of the platform-currency costs of its days', async () => {
      const { id } = await filled();

      const { cityGroups } = await itineraries.findMine(owner, id);

      // cairo (day 1): 2500 + 9000 + 3500 = 15000; dubai (day 2): 700. The 25000 EGP flight is another currency.
      expect(cityGroups.map((g) => g.subtotalCents)).toEqual([15000, 700]);
    });
  });
});
