import { Module } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { UploadsModule } from './uploads.module';
import { UploadService } from './upload.service';
import { UploadRecoveryService } from './upload-recovery.service';
import { UploadedFile } from './schemas/uploaded-file.schema';
import { UPLOAD_OPTIONS } from './upload-options';
import { UploadStorage } from './upload-storage';
import { UploadFile } from './upload.types';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
@Module({ imports: [UploadsModule] })
class ConsumerModule {}
jest.setTimeout(120000);

describe('UploadService real MongoDB, filesystem, concurrency and recovery', () => {
  let module: TestingModule;
  let mongo: MongoMemoryServer;
  let root: string;
  let service: UploadService;
  let storage: UploadStorage;
  let recovery: UploadRecoveryService;
  let model: Model<UploadedFile>;
  let file: UploadFile;
  const target = { kind: 'hotel' as const, ownerId: 'hotel_1' };
  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'gen08-integration-'));
    mongo = await MongoMemoryServer.create();
    module = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), ConsumerModule],
    })
      .overrideProvider(UPLOAD_OPTIONS)
      .useValue({
        root,
        leaseMs: 60000,
        recoveryIntervalMs: 3600000,
        recoveryBatchSize: 5,
      })
      .compile();
    await module.init();
    service = module.get(UploadService);
    storage = module.get(UploadStorage);
    recovery = module.get(UploadRecoveryService);
    model = module
      .get<Connection>(getConnectionToken())
      .model<UploadedFile>(UploadedFile.name);
    const buffer = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer();
    file = { buffer, size: buffer.length, mimetype: 'image/png' };
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await model.deleteMany({});
    for (const directory of ['staging', 'public'])
      for (const name of await fs.readdir(join(root, directory)))
        await fs.unlink(join(root, directory, name));
  });
  afterAll(async () => {
    await module?.close();
    await mongo?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('persists verified metadata and original bytes with safe filenames, then removes idempotently', async () => {
    const result = await service.save(
      { ...file, originalname: '../../secret.png' } as UploadFile,
      target,
    );
    expect(result.id).toMatch(/^[a-f0-9]{24}$/);
    expect(result.url).toBe(`/uploads/${result.id}.png`);
    expect(await fs.readFile(join(root, 'public', `${result.id}.png`))).toEqual(
      file.buffer,
    );
    expect(await fs.readdir(join(root, 'staging'))).toEqual([]);
    expect(await model.findById(result.id).lean()).toMatchObject({
      kind: 'hotel',
      ownerId: 'hotel_1',
      active: true,
      state: 'ready',
      slot: 1,
      contentType: 'image/png',
      sizeBytes: file.size,
      createdAt: expect.any(Date),
    });
    await service.remove(result.id);
    await service.remove(result.id);
    await service.remove(new Types.ObjectId().toString());
    expect(await model.countDocuments()).toBe(0);
    expect(await fs.readdir(join(root, 'public'))).toEqual([]);
  });
  it.each(['post', 'activity', 'hotel'] as const)(
    'allows five %s images, rejects sixth, releases capacity after removal',
    async (kind) => {
      const refs = [];
      for (let i = 0; i < 5; i++)
        refs.push(await service.save(file, { kind, ownerId: 'same' }));
      await expect(
        service.save(file, { kind, ownerId: 'same' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await model.countDocuments({ kind, active: true })).toBe(5);
      await service.remove(refs[0].id);
      await expect(
        service.save(file, { kind, ownerId: 'same' }),
      ).resolves.toHaveProperty('id');
    },
  );
  it('permits one airline logo and isolates kinds and entities', async () => {
    await service.save(file, { kind: 'airline', ownerId: 'same' });
    await expect(
      service.save(file, { kind: 'airline', ownerId: 'same' }),
    ).rejects.toMatchObject({ status: 409 });
    const results = await Promise.all([
      service.save(file, { kind: 'airline', ownerId: 'other' }),
      service.save(file, { kind: 'post', ownerId: 'same' }),
      service.save(file, { kind: 'hotel', ownerId: 'same' }),
    ]);
    expect(new Set(results.map((ref) => ref.id)).size).toBe(3);
  });
  it('arbitrates two service instances competing for the final slot and many airline requests', async () => {
    for (let i = 0; i < 4; i++) await service.save(file, target);
    const second = new UploadService(model, storage, recovery, {
      root,
      leaseMs: 60000,
      recoveryIntervalMs: 3600000,
      recoveryBatchSize: 5,
    });
    const race = await Promise.allSettled([
      service.save(file, target),
      second.save(file, target),
    ]);
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(race.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    expect(await model.countDocuments({ ...target, active: true })).toBe(5);
    const logos = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.save(file, { kind: 'airline', ownerId: 'race' }),
      ),
    );
    expect(
      logos.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
  });
  it('has a unique active-slot index, with no read-count-then-insert coordination', async () => {
    const indexes = await model.collection.indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { kind: 1, ownerId: 1, slot: 1 },
        unique: true,
        partialFilterExpression: { active: true },
      }),
    );
    const count = jest.spyOn(model, 'countDocuments');
    await service.save(file, target);
    expect(count).not.toHaveBeenCalled();
  });
  it('cleans a partially written file and releases reservation after filesystem failure', async () => {
    jest.spyOn(storage, 'write').mockImplementationOnce(async (record) => {
      await fs.writeFile(storage.paths(record).staging, file.buffer);
      throw new Error('synthetic-private-disk-error');
    });
    await expect(service.save(file, target)).rejects.toThrow(
      'Image could not be stored',
    );
    expect(await model.countDocuments()).toBe(0);
    expect(await fs.readdir(join(root, 'staging'))).toEqual([]);
    await expect(service.save(file, target)).resolves.toHaveProperty('id');
  });
  it('does not store a file when reservation persistence fails', async () => {
    jest.spyOn(model, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('synthetic-private-db-error');
    });
    await expect(service.save(file, target)).rejects.toThrow(
      'Image could not be stored',
    );
    expect(await fs.readdir(join(root, 'public'))).toEqual([]);
  });
  it('compensates a definitive finalization failure after file publication', async () => {
    jest.spyOn(model, 'updateOne').mockImplementationOnce(() => {
      throw new Error('synthetic-private-db-error');
    });
    await expect(service.save(file, target)).rejects.toThrow(
      'Image could not be stored',
    );
    expect(await model.countDocuments()).toBe(0);
    expect(await fs.readdir(join(root, 'public'))).toEqual([]);
  });
  it('does not delete a committed upload after uncertain ready acknowledgement', async () => {
    const update = model.updateOne.bind(model);
    jest
      .spyOn(model, 'updateOne')
      .mockImplementationOnce((...args: unknown[]) => {
        const query = (
          update as unknown as (
            ...parameters: unknown[]
          ) => ReturnType<typeof model.updateOne>
        )(...args);
        const execute = query.exec.bind(query);
        query.exec = jest.fn(async () => {
          await execute();
          throw new Error('synthetic-lost-acknowledgement');
        });
        return query;
      });
    await expect(service.save(file, target)).rejects.toThrow(
      'Image could not be stored',
    );
    const ready = await model.findOne({ state: 'ready' }).lean();
    expect(ready).not.toBeNull();
    expect(await fs.readFile(join(root, 'public', ready!.storageKey))).toEqual(
      file.buffer,
    );
  });
  it('retains deletion capacity on disk failure and retries safely', async () => {
    const ref = await service.save(file, {
      kind: 'airline',
      ownerId: 'deletion',
    });
    jest
      .spyOn(storage, 'remove')
      .mockRejectedValueOnce(new Error('synthetic-disk-error'));
    await expect(service.remove(ref.id)).rejects.toThrow(
      'Image could not be removed',
    );
    await expect(
      service.save(file, { kind: 'airline', ownerId: 'deletion' }),
    ).rejects.toMatchObject({ status: 409 });
    await recovery.sweep();
    expect(await model.findById(ref.id)).toBeNull();
    await expect(
      service.save(file, { kind: 'airline', ownerId: 'deletion' }),
    ).resolves.toHaveProperty('id');
  });
  it('retries DB failure after successful unlink and treats missing files as deleted', async () => {
    const ref = await service.save(file, target);
    jest.spyOn(model, 'deleteOne').mockImplementationOnce(() => {
      throw new Error('synthetic-db-error');
    });
    await expect(service.remove(ref.id)).rejects.toThrow(
      'Image could not be removed',
    );
    expect(await fs.readdir(join(root, 'public'))).toEqual([]);
    expect(await model.findById(ref.id)).toMatchObject({ state: 'deleting' });
    await service.remove(ref.id);
    expect(await model.findById(ref.id)).toBeNull();
  });
  it('reclaims expired pending work but prevents a stalled writer from committing over its replacement', async () => {
    const write = storage.write.bind(storage);
    let entered!: () => void, resume!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    jest
      .spyOn(storage, 'write')
      .mockImplementationOnce(async (record, buffer) => {
        entered();
        await gate;
        await write(record, buffer);
      });
    const stalled = service
      .save(file, { kind: 'airline', ownerId: 'stalled' })
      .catch((error) => error);
    await started;
    const old = (await model.findOne({ state: 'pending' }).lean())!;
    await model.updateOne(
      { _id: old._id },
      { $set: { leaseUntil: new Date(0) } },
    );
    await recovery.sweep();
    const replacement = await service.save(file, {
      kind: 'airline',
      ownerId: 'stalled',
    });
    resume();
    expect(await stalled).toMatchObject({ status: 500 });
    expect(await model.findById(replacement.id)).toMatchObject({
      state: 'ready',
    });
    expect(await fs.readdir(join(root, 'public'))).toEqual([
      `${replacement.id}.png`,
    ]);
  });
  it('removes old generated orphans while preserving ready files and unrelated filenames', async () => {
    const ready = await service.save(file, target);
    const orphan = `${new Types.ObjectId()}.png`;
    await fs.writeFile(join(root, 'public', orphan), file.buffer);
    await fs.utimes(join(root, 'public', orphan), new Date(0), new Date(0));
    await fs.writeFile(join(root, 'public', 'do-not-touch.txt'), 'fixture');
    await recovery.sweep();
    expect(await fs.readdir(join(root, 'public'))).toEqual(
      expect.arrayContaining([`${ready.id}.png`, 'do-not-touch.txt']),
    );
    expect(await fs.readdir(join(root, 'public'))).not.toContain(orphan);
  });
  it('rejects invalid IDs and corrupted metadata without touching outside files', async () => {
    for (const id of ['../../secret', '', 'not-an-id'])
      await expect(service.remove(id)).rejects.toMatchObject({ status: 400 });
    const outside = join(root, 'protected.txt');
    await fs.writeFile(outside, 'keep');
    const ref = await service.save(file, target);
    await model.updateOne(
      { _id: ref.id },
      { $set: { storageKey: '../protected.txt' } },
    );
    await expect(service.remove(ref.id)).rejects.toThrow(
      'Image could not be removed',
    );
    expect(await fs.readFile(outside, 'utf8')).toBe('keep');
  });
});
