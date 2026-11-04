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
