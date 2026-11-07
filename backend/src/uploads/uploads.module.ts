import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { Response } from 'express';
import { join } from 'node:path';
import {
  UploadedFile,
  UploadedFileSchema,
} from './schemas/uploaded-file.schema';
import { UPLOAD_OPTIONS, UploadOptions } from './upload-options';
import { UploadStorageModule } from './upload-storage.module';
import { UploadRecoveryService } from './upload-recovery.service';
import { UploadService } from './upload.service';

@Module({
  imports: [
    UploadStorageModule,
    MongooseModule.forFeature([
      { name: UploadedFile.name, schema: UploadedFileSchema },
    ]),
    ServeStaticModule.forRootAsync({
      imports: [UploadStorageModule],
      inject: [UPLOAD_OPTIONS],
      useFactory: (options: UploadOptions) => [
        {
          rootPath: join(options.root, 'public'),
          serveRoot: '/uploads',
          useGlobalPrefix: false,
          renderPath: '/{*path}',
          exclude: ['/uploads', '/uploads/{*path}'],
          serveStaticOptions: {
            index: false,
            redirect: false,
            dotfiles: 'deny',
            fallthrough: true,
            maxAge: 0,
            setHeaders: (response: Response) => {
              response.setHeader('X-Content-Type-Options', 'nosniff');
            },
          },
        },
      ],
    }),
  ],
  providers: [UploadService, UploadRecoveryService],
  exports: [UploadService],
})
export class UploadsModule {}
