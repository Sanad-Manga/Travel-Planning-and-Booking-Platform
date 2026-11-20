import { Module } from '@nestjs/common';
import { UPLOAD_OPTIONS, uploadOptions } from './upload-options';
import { UploadStorage } from './upload-storage';

@Module({
  providers: [
    { provide: UPLOAD_OPTIONS, useFactory: uploadOptions },
    UploadStorage,
  ],
  exports: [UPLOAD_OPTIONS, UploadStorage],
})
export class UploadStorageModule {}
