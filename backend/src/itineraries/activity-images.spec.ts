import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  AuthenticatedUser,
  IMAGE_MAX_BYTES,
  MAX_IMAGES_PER_ENTITY,
  Role,
} from '../common';
import { UploadFile } from '../uploads';
import { UPLOAD_OPTIONS } from '../uploads/upload-options';
import { ActivitiesService } from './activities.service';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';
import { Activity } from './schemas/activity.schema';

jest.setTimeout(120000);

describe('Activity images (ITN-12) with the real UploadService and isolated storage', () => {
  let server: MongoMemoryServer;
  let moduleRef: TestingModule;
  let root: string;
  let activities: ActivitiesService;
  let itineraries: ItinerariesService;
  let model: Model<Activity>;
  let connection: Connection;
  let png: Buffer;
  let jpeg: Buffer;

  const userWithId = (): AuthenticatedUser => ({
    userId: new Types.ObjectId().toString(),
    role: Role.USER,
  });
  const owner = userWithId();
  const stranger = userWithId();

  const asFile = (buffer: Buffer, mimetype: string): UploadFile => ({
    buffer,
    size: buffer.length,
    mimetype,
  });
  const pngFile = () => asFile(png, 'image/png');

  /** An itinerary of the owner with one day and one activity on it. */
  const withActivity = async () => {
    const { id } = await itineraries.create(owner, {
      title: 'Egypt',
      countryCodes: ['EG'],
      startDate: '2026-12-20',
    });
    const day = await itineraries.addDay(owner, id, { cityId: 'cairo' });
    const activity = await activities.create(owner, id, day.id, {
      name: 'Pyramids',
    });
    return { itineraryId: id, activity };
  };
  const uploadCount = () =>
    connection.collection('uploadedFiles').countDocuments({});
  const exists = (file: string) =>
    fs.access(join(root, 'public', file)).then(
      () => true,
      () => false,
    );
  const fileOf = (url: string) => url.replace('/uploads/', '');

  beforeAll(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'itn12-'));
    server = await MongoMemoryServer.create({
      instance: { dbName: 'itn12_activity_images_disposable_test' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(server.getUri()), ItinerariesModule],
    })
      .overrideProvider(UPLOAD_OPTIONS)
      .useValue({
        root,
        leaseMs: 60_000,
        recoveryIntervalMs: 3_600_000,
        recoveryBatchSize: 50,
      })
      .compile();
    await moduleRef.init();
    activities = moduleRef.get(ActivitiesService);
    itineraries = moduleRef.get(ItinerariesService);
    model = moduleRef.get<Model<Activity>>(getModelToken(Activity.name));
    connection = moduleRef.get<Connection>(getConnectionToken());

    await connection
      .collection('countries')
      .insertMany([{ code: 'EG', name: 'Egypt', currency: 'EGP' }]);
    await connection
      .collection('cities')
      .insertMany([{ city_id: 'cairo', name: 'Cairo', country_code: 'EG' }]);
    const blank = {
      create: { width: 4, height: 4, channels: 3 as const, background: '#c00' },
    };
    png = await sharp(blank).png().toBuffer();
    jpeg = await sharp(blank).jpeg().toBuffer();
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('attach', () => {
    it('stores a PNG and a JPEG and lists them on the activity, with a public URL that exists', async () => {
      const { activity } = await withActivity();

      await activities.attachImage(owner, activity.id, pngFile());
      const updated = await activities.attachImage(
        owner,
        activity.id,
        asFile(jpeg, 'image/jpeg'),
      );

      expect(updated.images).toHaveLength(2);
      expect(updated.images[0]).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        url: expect.stringMatching(/^\/uploads\/[0-9a-f]{24}\.png$/),
      });
      expect(updated.images[1].url).toMatch(/\.jpg$/);
      for (const image of updated.images) {
        expect(await exists(fileOf(image.url))).toBe(true);
      }
    });

    it('shows the images under the activity on the itinerary', async () => {
      const { itineraryId, activity } = await withActivity();
      const updated = await activities.attachImage(
        owner,
        activity.id,
        pngFile(),
      );

      const itinerary = await itineraries.findMine(owner, itineraryId);

      expect(itinerary.days[0].activities[0].images).toEqual(updated.images);
    });

    it('has no images until one is attached', async () => {
      const { activity } = await withActivity();
      expect(activity.images).toEqual([]);
    });

    it('rejects a wrong type, a disguised file, an empty file and a file over 5 MB with 400, and stores nothing', async () => {
      const { activity } = await withActivity();
      const before = await uploadCount();

      for (const file of [
        asFile(Buffer.from('plain text'), 'text/plain'),
        asFile(png, 'image/gif'),
        asFile(Buffer.from('not really a png'), 'image/png'),
        asFile(Buffer.alloc(0), 'image/png'),
        asFile(Buffer.alloc(IMAGE_MAX_BYTES + 1), 'image/png'),
      ]) {
        await expect(
          activities.attachImage(owner, activity.id, file),
        ).rejects.toMatchObject({ status: 400 });
      }
      await expect(
        activities.attachImage(
          owner,
          activity.id,
          undefined as unknown as UploadFile,
        ),
      ).rejects.toMatchObject({ status: 400 });

      expect(await uploadCount()).toBe(before);
      expect((await model.findById(activity.id).lean())?.images ?? []).toEqual(
        [],
      );
    });

    it('rejects a 6th image with 409 and keeps the five', async () => {
      const { activity } = await withActivity();
      for (let i = 0; i < MAX_IMAGES_PER_ENTITY; i++) {
        await activities.attachImage(owner, activity.id, pngFile());
      }

      await expect(
        activities.attachImage(owner, activity.id, pngFile()),
      ).rejects.toMatchObject({ status: 409 });

      expect((await model.findById(activity.id).lean())?.images).toHaveLength(
        MAX_IMAGES_PER_ENTITY,
      );
    });

    it('lets at most 5 of 8 simultaneous uploads in', async () => {
      const { activity } = await withActivity();

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          activities.attachImage(owner, activity.id, pngFile()),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      expect((await model.findById(activity.id).lean())?.images).toHaveLength(
        5,
      );
    });

    it("answers 404 for someone else's or an unknown activity and stores nothing", async () => {
      const { activity } = await withActivity();
      const before = await uploadCount();

      await expect(
        activities.attachImage(stranger, activity.id, pngFile()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        activities.attachImage(
          owner,
          new Types.ObjectId().toString(),
          pngFile(),
        ),
      ).rejects.toMatchObject({ status: 404 });

      expect(await uploadCount()).toBe(before);
    });
  });

  describe('remove', () => {
    it('removes the reference and the stored file, and a second remove answers 404', async () => {
      const { activity } = await withActivity();
      const attached = await activities.attachImage(
        owner,
        activity.id,
        pngFile(),
      );
      const [image] = attached.images;

      await activities.removeImage(owner, activity.id, image.id);

      expect((await model.findById(activity.id).lean())?.images ?? []).toEqual(
        [],
      );
      expect(await exists(fileOf(image.url))).toBe(false);
      await expect(
        activities.removeImage(owner, activity.id, image.id),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('only removes the image that was named', async () => {
      const { activity } = await withActivity();
      await activities.attachImage(owner, activity.id, pngFile());
      const attached = await activities.attachImage(
        owner,
        activity.id,
        pngFile(),
      );
      const [first, second] = attached.images;

      await activities.removeImage(owner, activity.id, first.id);

      const left = await model.findById(activity.id).lean();
      expect(left?.images.map((i) => i.id)).toEqual([second.id]);
      expect(await exists(fileOf(second.url))).toBe(true);
    });

    it("answers 404 for someone else's activity, an image of another activity or an unknown image, and keeps everything", async () => {
      const { activity } = await withActivity();
      const other = await withActivity();
      const attached = await activities.attachImage(
        owner,
        activity.id,
        pngFile(),
      );
      const otherAttached = await activities.attachImage(
        owner,
        other.activity.id,
        pngFile(),
      );

      await expect(
        activities.removeImage(stranger, activity.id, attached.images[0].id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        activities.removeImage(owner, activity.id, otherAttached.images[0].id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        activities.removeImage(
          owner,
          activity.id,
          new Types.ObjectId().toString(),
        ),
      ).rejects.toMatchObject({ status: 404 });

      expect(await exists(fileOf(attached.images[0].url))).toBe(true);
      expect(await exists(fileOf(otherAttached.images[0].url))).toBe(true);
    });

    it('frees the place, so another image can be attached after removing one of five', async () => {
      const { activity } = await withActivity();
      let attached = await activities.attachImage(
        owner,
        activity.id,
        pngFile(),
      );
      for (let i = 1; i < MAX_IMAGES_PER_ENTITY; i++) {
        attached = await activities.attachImage(owner, activity.id, pngFile());
      }
      await activities.removeImage(owner, activity.id, attached.images[0].id);

      const again = await activities.attachImage(owner, activity.id, pngFile());

      expect(again.images).toHaveLength(MAX_IMAGES_PER_ENTITY);
    });
  });

  describe('cleanup when the activity goes away', () => {
    it('deletes the stored files when the activity is deleted', async () => {
      const { activity } = await withActivity();
      const attached = await activities.attachImage(
        owner,
        activity.id,
        pngFile(),
      );

      await activities.remove(owner, activity.id);

      expect(await exists(fileOf(attached.images[0].url))).toBe(false);
    });

    it('deletes the stored files when the day or the itinerary is deleted', async () => {
      const first = await withActivity();
      const second = await withActivity();
      const a = await activities.attachImage(
        owner,
        first.activity.id,
        pngFile(),
      );
      const b = await activities.attachImage(
        owner,
        second.activity.id,
        pngFile(),
      );

      await itineraries.removeDay(
        owner,
        first.itineraryId,
        first.activity.dayId,
      );
      await itineraries.remove(owner, second.itineraryId);

      expect(await exists(fileOf(a.images[0].url))).toBe(false);
      expect(await exists(fileOf(b.images[0].url))).toBe(false);
    });
  });
});
