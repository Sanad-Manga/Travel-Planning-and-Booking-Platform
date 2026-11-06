import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
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

    // The seeded countries this module is allowed to accept (the real seed has many more).
    await moduleRef
      .get<Connection>(getConnectionToken())
      .collection('countries')
      .insertMany([
        { code: 'EG', name: 'Egypt', currency: 'EGP' },
        { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
        { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
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

    it("answers 404 for someone else's itinerary, even a public one", async () => {
      const { id } = await service.create(owner, validDto);
      await model.updateOne({ _id: id }, { visibility: Visibility.PUBLIC });
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
