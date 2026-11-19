import {
  ForbiddenException,
  Injectable,
  Logger,
  NestMiddleware,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { NextFunction, Response } from 'express';
import { Model } from 'mongoose';
import { readJwtSecrets } from '../auth/jwt-secrets';
import { Post } from '../blog/schemas/post.schema';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
  PostStatus,
  Role,
} from '../common';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { UsersService } from '../users/users.service';
import { UploadedFile } from './schemas/uploaded-file.schema';
import { UploadStorage } from './upload-storage';

/** Raw /uploads gate, mounted during configure(), before ServeStatic's onModuleInit. */
@Injectable()
export class UploadVisibilityMiddleware implements NestMiddleware {
  private readonly authentication: JwtAuthGuard;
  private readonly logger = new Logger(UploadVisibilityMiddleware.name);

  constructor(
    @InjectModel(UploadedFile.name) private readonly files: Model<UploadedFile>,
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly storage: UploadStorage,
    users: UsersService,
    reflector: Reflector,
    config: ConfigService,
  ) {
    // Reuse the complete guard, not a second token/session verifier. Its dependencies
    // are wired privately: no global JwtService replacement or new auth exports.
    // Lazy official-secret resolution preserves storage-only consumers' startup;
    // the real AuthModule still validates application secrets at startup as before.
    this.authentication = new JwtAuthGuard(
      new JwtService({
        secretOrKeyProvider: () => readJwtSecrets(config).access,
        verifyOptions: { algorithms: ['HS256'] },
      }),
      reflector,
      users,
    );
  }

  async use(
    request: AuthenticatedRequest,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await this.check(request, response, next);
      next();
    } catch (error) {
      response.setHeader('Cache-Control', 'no-store');
      // ServeStatic's excluded-route error handler replaces next(error) with 404.
      // Finish here using the existing sanitized error format, before static handlers.
      const failure =
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
          ? error
          : new ServiceUnavailableException('Image temporarily unavailable');
      new AllExceptionsFilter().catch(
        failure,
        new ExecutionContextHost([request, response, next]),
      );
    }
  }

  private async check(
    request: AuthenticatedRequest,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    // Match generated canonical filenames before any static decoding/normalization.
    const match = /^\/([a-f0-9]{24})\.(jpg|png)$/.exec(
      request.url.split('?')[0],
    );
    if (!match || !['GET', 'HEAD'].includes(request.method))
      throw this.notFound();
    const filename = `${match[1]}.${match[2]}`;
    let record;
    try {
      record = await this.files
        .findById(match[1])
        .select('kind ownerId storageKey contentType state active')
        .lean()
        .exec();
    } catch {
      throw this.unavailable('metadata', match[1]);
    }
    if (
      !record ||
      record.state !== 'ready' ||
      record.active !== true ||
      record.storageKey !== filename
    )
      throw this.notFound();
    try {
      this.storage.paths(record);
    } catch {
      throw this.notFound();
    }
    if (
      record.kind === 'hotel' ||
      record.kind === 'activity' ||
      record.kind === 'airline'
    )
      return;
    if (record.kind !== 'post') throw this.notFound();

    response.locals.gh116BlogImage = true;
    response.setHeader('Cache-Control', 'no-store');
    response.vary('Cookie');
    if (!/^[a-f0-9]{24}$/i.test(record.ownerId)) throw this.notFound();
    let post;
    try {
      post = await this.posts
        .findById(record.ownerId)
        .select('authorId status isHidden images')
        .lean()
        .exec();
    } catch {
      throw this.unavailable('post', match[1]);
    }
    if (
      !post ||
      !post.images?.some(
        (image) =>
          image.id === match[1] && image.url === `/uploads/${filename}`,
      )
    )
      throw this.notFound();
    if (post.status === PostStatus.PUBLISHED && post.isHidden === false) return;
    if (
      post.status !== PostStatus.DRAFT &&
      !(post.status === PostStatus.PUBLISHED && post.isHidden === true)
    )
      throw this.notFound();

    // This context has neither @Public nor @AllowWhenMustChange metadata.
    // Clear any earlier optional principal: identity comes only from the real guard.
    delete request.user;
    const context = new ExecutionContextHost(
      [request, response, next],
      UploadVisibilityMiddleware,
      UploadVisibilityMiddleware.prototype.use,
    );
    context.setType('http');
    try {
      if (!(await this.authentication.canActivate(context)))
        throw this.notFound();
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      )
        throw this.notFound();
      throw this.unavailable('session', match[1]);
    }
    const viewer = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().user;
    if (
      viewer &&
      (viewer.userId === post.authorId?.toString() ||
        (post.status === PostStatus.PUBLISHED &&
          post.isHidden === true &&
          viewer.role === Role.ADMIN))
    )
      return;
    throw this.notFound();
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Image not found');
  }
  private unavailable(
    stage: 'metadata' | 'post' | 'session',
    id: string,
  ): ServiceUnavailableException {
    this.logger.warn(
      `Upload visibility ${stage} lookup unavailable; imageId=${id}`,
    );
    return new ServiceUnavailableException('Image temporarily unavailable');
  }
}
