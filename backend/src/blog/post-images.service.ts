import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../common';
import { UploadFile, UploadService } from '../uploads';
import { PostImageDto } from './dto/post-image.dto';
import { Post } from './schemas/post.schema';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * BLG-10: the author attaches images to their own post and removes them. Same pattern as ITN-12 (activity images).
 * The shared UploadService checks the file (JPG/PNG, real image, 5 MB) and the limit of 5 images per post: it keeps
 * one numbered slot per image, so two uploads at the same time can never both take the 5th place.
 */
@Injectable()
export class PostImagesService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly uploads: UploadService,
  ) {}

  /**
   * Ownership first (404 for a missing post or someone else's), then the upload service validates and stores the
   * file (400 bad file, 409 when the 5 places are taken). Only then is the reference pushed onto the post. If that
   * push fails, or the post was deleted in between, the stored file is removed again.
   */
  async attach(id: string, actor: AuthenticatedUser, file: UploadFile): Promise<PostImageDto> {
    const postId = this.postId(id);
    const filter = { _id: postId, authorId: new Types.ObjectId(actor.userId) };
    if (!(await this.posts.exists(filter))) throw new NotFoundException('Post not found');

    const image = await this.uploads.save(file, { kind: 'post', ownerId: postId.toString() });
    try {
      const result = await this.posts.updateOne(filter, { $push: { images: { id: image.id, url: image.url } } }).exec();
      if (result.matchedCount === 1) return image;
    } catch (error) {
      await this.removeStoredImages(postId.toString(), [image]);
      throw error;
    }
    await this.removeStoredImages(postId.toString(), [image]);
    throw new NotFoundException('Post not found');
  }

  /**
   * The image must be one of this post's images, and the post must be the caller's (404 otherwise), so nobody can
   * delete another entity's file through this route. The file is removed first (safe to repeat), then the reference
   * is pulled in one conditional update, so a failure in between can simply be retried.
   */
  async remove(id: string, imageId: string, actor: AuthenticatedUser): Promise<void> {
    const postId = this.postId(id);
    const filter = { _id: postId, authorId: new Types.ObjectId(actor.userId), 'images.id': imageId };
    if (!(await this.posts.exists(filter))) throw new NotFoundException('Post or image not found');

    await this.removeFile(postId.toString(), imageId);
    const result = await this.posts.updateOne(filter, { $pull: { images: { id: imageId } } }).exec();
    if (result.matchedCount === 0) throw new NotFoundException('Post or image not found');
  }

  /**
   * Used when a post is deleted (BlogService.deletePostAndDependents). Failures are not reported: the post is already
   * gone, and the upload service retries what it could not finish (its `deleting` state).
   */
  async removeStoredImages(postId: string, images: { id: string }[]): Promise<void> {
    await Promise.allSettled(images.map((image) => this.removeFile(postId, image.id)));
  }

  /**
   * removeForTarget only deletes a file that the upload service stored for THIS post. Posts created before BLG-10
   * could hold any id the client sent; such a reference is just pulled, and nobody else's file is touched.
   */
  private async removeFile(postId: string, imageId: string): Promise<void> {
    if (!OBJECT_ID.test(imageId)) return;
    await this.uploads.removeForTarget(imageId, { kind: 'post', ownerId: postId });
  }

  // A malformed id can never match, so it gets the same 404 as an unknown one.
  private postId(id: string): Types.ObjectId {
    if (!OBJECT_ID.test(id)) throw new NotFoundException('Post not found');
    return new Types.ObjectId(id);
  }
}
