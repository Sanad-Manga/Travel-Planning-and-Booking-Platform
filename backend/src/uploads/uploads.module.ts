import { Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { Post, PostSchema } from '../blog/schemas/post.schema';
import { UsersModule } from '../users/users.module';
import { UploadVisibilityMiddleware } from './upload-visibility.middleware';
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
    ConfigModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: UploadedFile.name, schema: UploadedFileSchema },
      { name: Post.name, schema: PostSchema },
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
              if (response.locals.gh116BlogImage)
                response.setHeader('Cache-Control', 'no-store');
            },
          },
        },
      ],
    }),
  ],
  providers: [UploadService, UploadRecoveryService, UploadVisibilityMiddleware],
  exports: [UploadService],
})
export class UploadsModule implements NestModule {
  constructor(
    private readonly visibility: UploadVisibilityMiddleware,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  configure(): void {
    // Raw root mount shares static serving's matching semantics and avoids the /api prefix.
    // configure() runs before ServeStaticModule.onModuleInit registers its file middleware.
    this.adapterHost.httpAdapter.use(
      '/uploads',
      this.visibility.use.bind(this.visibility),
    );
  }
}
