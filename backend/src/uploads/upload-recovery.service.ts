import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { UploadedFile } from './schemas/uploaded-file.schema';
import { UPLOAD_OPTIONS, UploadOptions } from './upload-options';
import { UploadStorage } from './upload-storage';

/** Internal maintenance, not a consumer API. No external queue or scheduler needed. */
@Injectable()
export class UploadRecoveryService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly cursors: Record<string, string> = {
    staging: '',
    public: '',
  };
  private readonly logger = new Logger(UploadRecoveryService.name);
  constructor(
    @InjectModel(UploadedFile.name) private readonly files: Model<UploadedFile>,
    private readonly storage: UploadStorage,
    @Inject(UPLOAD_OPTIONS) private readonly options: UploadOptions,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.storage.initialize();
      // Do not accept traffic until the capacity constraint exists, even with autoIndex disabled.
      await this.files.createIndexes();
    } catch {
      throw new Error('Upload storage or indexes could not be initialized');
    }
    await this.sweep();
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.options.recoveryIntervalMs);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** Retire only a still-pending attempt. A committed upload is never compensation-deleted. */
  async abandon(id: Types.ObjectId): Promise<void> {
    const retired = await this.files
      .findOneAndUpdate(
        { _id: id, state: 'pending' },
        {
          $set: { state: 'cleanup', active: false },
          $unset: { leaseUntil: 1 },
        },
        { new: true },
      )
      .lean<UploadedFile>();
    if (retired) await this.clean(retired);
    else {
      const current = await this.files.findById(id).lean<UploadedFile>();
      // An expired reservation may already have been cleaned by another instance.
      if (!current) {
        for (const contentType of ['image/png', 'image/jpeg'])
          await this.storage.remove({
            _id: id,
            contentType,
            storageKey: `${id}.${contentType === 'image/png' ? 'png' : 'jpg'}`,
          } as UploadedFile);
      } else if (current.state === 'cleanup') await this.clean(current);
    }
  }

  async clean(record: UploadedFile): Promise<void> {
    await this.storage.remove(record);
    // If this update fails, durable state makes another remove/sweep retry safe.
    await this.files.deleteOne({
      _id: record._id,
      state: { $in: ['deleting', 'cleanup'] },
    });
  }

  sweep(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.recover()
      .catch(() => {
        this.logger.warn('Upload recovery deferred; cleanup will be retried');
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async recover(): Promise<void> {
    const expired = await this.files
      .find({ state: 'pending', $expr: { $lte: ['$leaseUntil', '$$NOW'] } })
      .limit(this.options.recoveryBatchSize)
      .lean<UploadedFile[]>();
    for (const record of expired) {
      await this.files.updateOne(
        {
          _id: record._id,
          state: 'pending',
          $expr: { $lte: ['$leaseUntil', '$$NOW'] },
        },
        {
          $set: { state: 'cleanup', active: false },
          $unset: { leaseUntil: 1 },
        },
      );
    }
    const work = await this.files
      .find({ state: { $in: ['cleanup', 'deleting'] } })
      .sort({ updatedAt: 1 })
      .limit(this.options.recoveryBatchSize)
      .lean<UploadedFile[]>();
    for (const record of work) {
      try {
        await this.clean(record);
      } catch {
        // Move a failing item to the back of the bounded work queue.
        await this.files.updateOne(
          { _id: record._id },
          { $currentDate: { updatedAt: true } },
        );
        this.logger.warn('An upload cleanup is pending retry');
      }
    }
    // Handles a stalled writer creating a file after its reservation was retired.
    // Only generated names, older than a lease, without ANY metadata may be removed.
    for (const directory of ['staging', 'public']) {
      const entries = (await fs.readdir(join(this.options.root, directory)))
        .filter((name) => /^[a-f0-9]{24}\.(?:part|png|jpg)$/.test(name))
        .map((name) => `${directory}/${name}`);
      const candidates = entries
        .filter((name) => name > this.cursors[directory])
        .sort()
        .slice(0, this.options.recoveryBatchSize);
      for (const name of candidates) {
        const path = join(this.options.root, name);
        try {
          const stat = await fs.lstat(path);
          if (
            !stat.isSymbolicLink() &&
            stat.isFile() &&
            Date.now() - stat.mtimeMs > this.options.leaseMs &&
            !(await this.files.exists({ _id: name.split('/')[1].slice(0, 24) }))
          )
            await fs.unlink(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      this.cursors[directory] =
        candidates.length === this.options.recoveryBatchSize
          ? candidates[candidates.length - 1]
          : '';
    }
  }
}
