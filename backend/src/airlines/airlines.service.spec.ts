import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, Role } from '../common';
import { AirlinesModule } from './airlines.module';
import { AirlinesService } from './airlines.service';
import { Airline } from './schemas/airline.schema';

jest.setTimeout(60000);

describe('AirlinesService with an isolated MongoDB', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let model: Model<Airline>;
  let service: AirlinesService;

  const moderatorOf = (airlineId: string): AuthenticatedUser => ({
    userId: new Types.ObjectId().toString(),
    role: Role.AIRLINE_MODERATOR,
    airlineId,
  });

  beforeAll(async () => {
    server = await MongoMemoryServer.create({
      instance: { dbName: 'flt01_airlines_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), AirlinesModule],
    }).compile();
    await moduleRef.init();
    model = moduleRef.get<Model<Airline>>(getModelToken(Airline.name));
    service = moduleRef.get(AirlinesService);
    await model.init(); // build the unique index before the tests rely on it
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  describe('create', () => {
    it('creates an airline and returns a DTO (id, no _id / __v)', async () => {
      const airline = await service.create({ name: 'EgyptAir', code: 'MS' });
      expect(airline).toMatchObject({
        name: 'EgyptAir',
        code: 'MS',
        isActive: true,
      });
      expect(airline.id).toMatch(/^[0-9a-f]{24}$/);
      expect(Object.keys(airline)).not.toEqual(
        expect.arrayContaining(['_id', '__v']),
      );
    });

    it('stores the logo url when given', async () => {
      const airline = await service.create({
        name: 'EgyptAir',
        code: 'MS',
        logoUrl: 'https://example.com/ms.png',
      });
      expect(airline.logoUrl).toBe('https://example.com/ms.png');
    });

    it('rejects a duplicate code with 409 and a field detail', async () => {
      await service.create({ name: 'EgyptAir', code: 'MS' });
      await expect(
        service.create({ name: 'Another', code: 'MS' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { details: [{ field: 'code' }] },
      });
    });
  });

  describe('getById / findById / exists', () => {
    it('returns the airline, 404 for a missing one', async () => {
      const created = await service.create({ name: 'EgyptAir', code: 'MS' });
      await expect(service.getById(created.id)).resolves.toMatchObject({
        code: 'MS',
      });
      await expect(
        service.getById(new Types.ObjectId().toString()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('findById and exists are false/null for unknown or malformed ids', async () => {
      const created = await service.create({ name: 'EgyptAir', code: 'MS' });
      expect(await service.exists(created.id)).toBe(true);
      expect(await service.exists(new Types.ObjectId().toString())).toBe(false);
      expect(await service.findById('not-an-id')).toBeNull();
    });
  });

  describe('update (ownership in the service)', () => {
    it('lets the moderator of that airline change name, code and logo', async () => {
      const created = await service.create({ name: 'EgyptAir', code: 'MS' });
      const updated = await service.update(
        moderatorOf(created.id),
        created.id,
        {
          name: 'Egypt Air',
          code: 'MX',
          logoUrl: 'https://example.com/new.png',
        },
      );
      expect(updated).toMatchObject({
        id: created.id,
        name: 'Egypt Air',
        code: 'MX',
        logoUrl: 'https://example.com/new.png',
      });
    });

    it('only changes the fields that were sent', async () => {
      const created = await service.create({
        name: 'EgyptAir',
        code: 'MS',
        logoUrl: 'https://example.com/ms.png',
      });
      const updated = await service.update(
        moderatorOf(created.id),
        created.id,
        {
          name: 'Renamed',
        },
      );
      expect(updated).toMatchObject({
        name: 'Renamed',
        code: 'MS',
        logoUrl: 'https://example.com/ms.png',
      });
    });

    it('rejects a moderator editing another airline with 403 and changes nothing', async () => {
      const mine = await service.create({ name: 'Mine', code: 'AA' });
      const other = await service.create({ name: 'Other', code: 'BB' });
      await expect(
        service.update(moderatorOf(mine.id), other.id, { name: 'Hacked' }),
      ).rejects.toMatchObject({ status: 403 });
      expect((await service.getById(other.id)).name).toBe('Other');
    });

    it.each([
      ['an admin', { role: Role.ADMIN }],
      ['a normal user', { role: Role.USER }],
      ['a hotel moderator', { role: Role.HOTEL_MODERATOR }],
    ])(
      'rejects %s with 403 even with a matching airlineId',
      async (_name, { role }) => {
        const created = await service.create({ name: 'EgyptAir', code: 'MS' });
        const user: AuthenticatedUser = {
          userId: new Types.ObjectId().toString(),
          role,
          airlineId: created.id,
        };
        await expect(
          service.update(user, created.id, { name: 'X1' }),
        ).rejects.toMatchObject({ status: 403 });
      },
    );

    it('rejects a moderator with no airline link with 403', async () => {
      const created = await service.create({ name: 'EgyptAir', code: 'MS' });
      const user: AuthenticatedUser = {
        userId: new Types.ObjectId().toString(),
        role: Role.AIRLINE_MODERATOR,
      };
      await expect(
        service.update(user, created.id, { name: 'X1' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('rejects an empty update with 400', async () => {
      const created = await service.create({ name: 'EgyptAir', code: 'MS' });
      await expect(
        service.update(moderatorOf(created.id), created.id, {}),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("rejects changing the code to another airline's code with 409", async () => {
      const a = await service.create({ name: 'A Air', code: 'AA' });
      await service.create({ name: 'B Air', code: 'BB' });
      await expect(
        service.update(moderatorOf(a.id), a.id, { code: 'BB' }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await service.getById(a.id)).code).toBe('AA');
    });

    it('answers 404 when the moderator is linked to an airline that no longer exists', async () => {
      const ghostId = new Types.ObjectId().toString();
      await expect(
        service.update(moderatorOf(ghostId), ghostId, { name: 'X1' }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
