import { Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { UPLOAD_OPTIONS, UploadOptions } from './upload-options';
import { UploadedFile } from './schemas/uploaded-file.schema';

@Injectable()
export class UploadStorage {
  constructor(@Inject(UPLOAD_OPTIONS) readonly options: UploadOptions) {}

  async initialize(): Promise<void> {
    if (resolve(this.options.root) !== this.options.root)
      throw new Error('Absolute upload root required');
    for (const directory of [
      this.options.root,
      join(this.options.root, 'staging'),
      join(this.options.root, 'public'),
    ]) {
      await fs.mkdir(directory, { recursive: true });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Unsafe upload directory');
    }
  }

  paths(record: Pick<UploadedFile, '_id' | 'storageKey' | 'contentType'>): {
    staging: string;
    public: string;
  } {
    const id = String(record._id);
    const extension =
      record.contentType === 'image/png'
        ? 'png'
        : record.contentType === 'image/jpeg'
          ? 'jpg'
          : '';
    if (
      !/^[a-f0-9]{24}$/.test(id) ||
      !extension ||
      record.storageKey !== `${id}.${extension}`
    )
      throw new Error('Invalid stored upload metadata');
    return {
      staging: join(this.options.root, 'staging', `${id}.part`),
      public: join(this.options.root, 'public', record.storageKey),
    };
  }

  async write(record: UploadedFile, buffer: Buffer): Promise<void> {
    const paths = this.paths(record);
    await fs.writeFile(paths.staging, buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(paths.staging, paths.public);
  }

  async remove(record: UploadedFile): Promise<void> {
    const paths = this.paths(record);
    for (const file of [paths.staging, paths.public]) {
      try {
        await fs.unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
}
