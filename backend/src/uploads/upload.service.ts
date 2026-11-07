import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Inject } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { MAX_IMAGES_PER_ENTITY, MAX_LOGOS_PER_AIRLINE } from '../common';
import { validateImage, validateTarget } from './image-validation';
import { UploadedFile } from './schemas/uploaded-file.schema';
import { UPLOAD_OPTIONS, UploadOptions } from './upload-options';
import { UploadRecoveryService } from './upload-recovery.service';
import { UploadStorage } from './upload-storage';
import { UploadFile, UploadReference, UploadTarget } from './upload.types';

@Injectable()
export class UploadService {
  constructor(
    @InjectModel(UploadedFile.name) private readonly files: Model<UploadedFile>,
    private readonly storage: UploadStorage,
    private readonly recovery: UploadRecoveryService,
    @Inject(UPLOAD_OPTIONS) private readonly options: UploadOptions,
  ) {}

  async save(file: UploadFile, target: UploadTarget): Promise<UploadReference> {
    const owner = validateTarget(target);
    const image = await validateImage(file);
    let record: UploadedFile | undefined;
    try {
      const max =
        owner.kind === 'airline'
          ? MAX_LOGOS_PER_AIRLINE
          : MAX_IMAGES_PER_ENTITY;
      for (let slot = 1; slot <= max; slot++) {
        const id = new Types.ObjectId();
        try {
          // Pipeline uses MongoDB's clock. The unique ACTIVE slot index arbitrates races.
          record = (await this.files
            .findOneAndUpdate(
              { _id: id },
              [
                {
                  $set: {
                    kind: { $literal: owner.kind },
                    ownerId: { $literal: owner.ownerId },
                    slot,
                    active: true,
                    state: 'pending',
                    storageKey: `${id}.${image.extension}`,
                    contentType: image.contentType,
                    sizeBytes: image.buffer.length,
                    leaseUntil: {
                      $dateAdd: {
                        startDate: '$$NOW',
                        unit: 'millisecond',
                        amount: this.options.leaseMs,
                      },
                    },
                    createdAt: '$$NOW',
                    updatedAt: '$$NOW',
                  },
                },
              ],
              {
                upsert: true,
                new: true,
                updatePipeline: true,
                timestamps: false,
              },
            )
            .lean<UploadedFile>())!;
          break;
        } catch (error) {
          if ((error as { code?: number }).code !== 11000) throw error;
        }
      }
      if (!record)
        throw new ConflictException('Image capacity exhausted for this entity');
      await this.storage.write(record, image.buffer);
      const result = await this.files.updateOne(
        {
          _id: record._id,
          state: 'pending',
          active: true,
          $expr: { $gt: ['$leaseUntil', '$$NOW'] },
        },
        { $set: { state: 'ready' }, $unset: { leaseUntil: 1 } },
      );
      if (result.modifiedCount !== 1) throw new Error('Reservation expired');
      return { id: String(record._id), url: `/uploads/${record.storageKey}` };
    } catch (error) {
      if (record) {
        try {
          await this.recovery.abandon(record._id);
        } catch {
          // Durable pending/cleanup metadata is retried; never delete on uncertain DB state.
        }
      }
      if (error instanceof ConflictException) throw error;
      throw new InternalServerErrorException('Image could not be stored');
    }
  }

  async remove(id: string): Promise<void> {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))
      throw new BadRequestException('Invalid upload identifier');
    try {
      // Pending attempts have not returned an ID and cannot be removed by a consumer.
      const record = await this.files
        .findOneAndUpdate(
          { _id: id, state: { $in: ['ready', 'deleting', 'cleanup'] } },
          { $set: { state: 'deleting' } },
          { new: true },
        )
        .lean<UploadedFile>();
      if (record) await this.recovery.clean(record);
    } catch {
      throw new InternalServerErrorException('Image could not be removed');
    }
  }
}
