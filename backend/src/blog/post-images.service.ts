import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuthenticatedUser, MAX_IMAGES_PER_ENTITY } from '../common';
import { UploadFile, UploadReference, UploadService } from '../uploads';
import { Post, PostImage } from './schemas/post.schema';

@Injectable()
export class PostImagesService {
  private readonly logger = new Logger(PostImagesService.name);
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly uploads: UploadService,
  ) {}

  async attach(
    id: string,
    actor: AuthenticatedUser,
    file: UploadFile,
  ): Promise<UploadReference> {
    const filter = this.ownedFilter(id, actor);
    const post = await this.loadOwned(filter);
    const postId = post._id.toString();
    if ((post.images ?? []).length >= MAX_IMAGES_PER_ENTITY)
      throw new ConflictException('A post can have at most five images');
    // Shared service validates bytes/decoding and reserves capacity. No disk write before ownership.
    const reference = await this.uploads.save(file, {
      kind: 'post',
      ownerId: postId,
    });
    let matched: number;
    try {
      const result = await this.posts
        .updateOne(
          {
            ...filter,
            [`images.${MAX_IMAGES_PER_ENTITY - 1}`]: { $exists: false },
            'images.id': { $ne: reference.id },
          },
          { $push: { images: reference } },
          { runValidators: true },
        )
        .exec();
      matched = result.matchedCount;
    } catch {
      // A lost acknowledgement can hide a committed write. An absent subsequent read
      // is NOT proof that an in-flight database write can no longer commit.
      try {
        if (await this.posts.exists({ ...filter, 'images.id': reference.id }))
          return reference;
      } catch {
        /* Keep the file when even reconciliation is unavailable. */
      }
      this.warn(
        postId,
        reference.id,
        'Attachment outcome uncertain; retained upload requires reconciliation',
      );
      throw new InternalServerErrorException(
        'Image attachment outcome is uncertain',
      );
    }
    if (matched === 1) return reference;
    // A definite non-match did not attach our unique ID; safe compensation.
    try {
      await this.uploads.removeForTarget(reference.id, {
        kind: 'post',
        ownerId: postId,
      });
    } catch {
      this.warn(
        postId,
        reference.id,
        'Unattached upload cleanup requires retry',
      );
      throw new InternalServerErrorException(
        'Image attachment failed; cleanup requires retry',
      );
    }
    let exists: boolean;
    try {
      exists = !!(await this.posts.exists(filter));
    } catch {
      throw new InternalServerErrorException('Post could not be verified');
    }
    if (!exists) throw new NotFoundException('Post not found');
    throw new ConflictException('Post image capacity or attachment changed');
  }

  async remove(
    id: string,
    imageId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const filter = this.ownedFilter(id, actor);
    if (typeof imageId !== 'string' || !/^[a-f0-9]{24}$/i.test(imageId))
      throw new NotFoundException('Post image not found');
    const post = await this.loadOwned(filter);
    const image = (post.images ?? []).find(
      (entry) => entry.id.toLowerCase() === imageId.toLowerCase(),
    );
    if (!image) throw new NotFoundException('Post image not found');
    // Leave membership durable until storage deletion completes; foreign legacy
    // references are detached without touching the other entity's physical file.
    await this.uploads.removeForTarget(image.id, {
      kind: 'post',
      ownerId: post._id.toString(),
    });
    let matched: number;
    try {
      const result = await this.posts
        .updateOne(
          { ...filter, 'images.id': image.id },
          { $pull: { images: { id: image.id } } },
        )
        .exec();
      matched = result.matchedCount;
    } catch {
      throw new InternalServerErrorException(
        'Image storage was removed; reference cleanup requires retry',
      );
    }
    if (!matched) throw new NotFoundException('Post image not found');
  }

  /** Called only with a post obtained through the existing authorized deletion filter. */
  async removeStoredImages(postId: string, images: PostImage[]): Promise<void> {
    for (const image of images) {
      // Legacy placeholder IDs never came from this service; never interpret their URL as a path.
      if (/^[a-f0-9]{24}$/i.test(image.id))
        await this.uploads.removeForTarget(image.id, {
          kind: 'post',
          ownerId: postId,
        });
    }
  }

  private ownedFilter(id: string, actor: AuthenticatedUser): FilterQuery<Post> {
    if (!actor?.userId)
      throw new UnauthorizedException('Authentication required');
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))
      throw new NotFoundException('Post not found');
    return {
      _id: new Types.ObjectId(id),
      authorId: new Types.ObjectId(actor.userId),
    };
  }

  private async loadOwned(filter: FilterQuery<Post>) {
    let post;
    try {
      post = await this.posts
        .findOne(filter)
        .select('_id images')
        .lean()
        .exec();
    } catch {
      throw new InternalServerErrorException('Post could not be retrieved');
    }
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  private warn(postId: string, imageId: string, message: string): void {
    // Only normalized identifiers, never binary data, paths, URLs or raw driver exceptions.
    this.logger.warn(`${message}; postId=${postId}; imageId=${imageId}`);
  }
}
