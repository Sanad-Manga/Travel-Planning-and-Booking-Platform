import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { AuthenticatedUser, MAX_IMAGES_PER_ENTITY, paginate, PaginatedResponse, PaginationDto, POST_MAX_TAGS, PostStatus } from '../common';
import { CreatePostDto } from './dto/create-post.dto';
import { MyPostRowDto } from './dto/my-post-row.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post } from './schemas/post.schema';

// See deletePostAndDependents for the assumption behind these names.
const DEPENDENT_COLLECTIONS = ['comments', 'likes'];

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * BLG-01: any logged-in user creates a post as DRAFT (default, private) or PUBLISHED.
   * The author is always the caller; isHidden always starts false. Neither can be sent in the body.
   */
  async create(dto: CreatePostDto, actor: AuthenticatedUser): Promise<PostResponseDto> {
    // Limits re-checked here too, so they hold for any caller of the service (contracts section 3).
    this.assertLimit('tags', dto.tags, POST_MAX_TAGS);
    this.assertLimit('images', dto.images, MAX_IMAGES_PER_ENTITY);

    const status = dto.status ?? PostStatus.DRAFT;
    const post = await this.posts.create({
      authorId: new Types.ObjectId(actor.userId),
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      images: dto.images ?? [],
      status,
      isHidden: false,
      ...(status === PostStatus.PUBLISHED ? { publishedAt: new Date() } : {}),
    });
    return PostResponseDto.from(post);
  }

  /**
   * BLG-03: the caller's own posts, drafts and hidden posts included, newest first.
   * Ownership is enforced here: the filter is always the caller's id, never a value from the request.
   */
  listMine(query: PaginationDto, actor: AuthenticatedUser): Promise<PaginatedResponse<MyPostRowDto>> {
    return paginate(this.posts, { authorId: new Types.ObjectId(actor.userId) }, query, {
      map: MyPostRowDto.fromLean,
      sort: { createdAt: -1, _id: -1 },
      projection: { body: 0, images: 0, tags: 0 },
    });
  }

  /**
   * BLG-04: the author edits their own post (hidden posts included). One atomic findOneAndUpdate
   * filtered by {_id, authorId}: someone else's, unknown or malformed id gives 404, never 403.
   * authorId, isHidden and the counters cannot be changed. publishedAt is set the first time the
   * post becomes PUBLISHED and kept afterwards (also if it goes back to DRAFT and is re-published).
   */
  async update(id: string, dto: UpdatePostDto, actor: AuthenticatedUser): Promise<PostResponseDto> {
    const changes: Partial<Record<'title' | 'body' | 'tags' | 'images' | 'status', unknown>> = {};
    for (const key of ['title', 'body', 'tags', 'images', 'status'] as const) {
      const value = dto[key];
      if (value === null) {
        throw new BadRequestException({ message: 'Validation failed', details: [{ field: key, message: `${key} must not be null` }] });
      }
      if (value !== undefined) changes[key] = value;
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({ message: 'Validation failed', details: [{ field: 'body', message: 'Send at least one field to update' }] });
    }
    this.assertLimit('tags', dto.tags, POST_MAX_TAGS);
    this.assertLimit('images', dto.images, MAX_IMAGES_PER_ENTITY);

    const filter = this.ownedFilter(id, actor);
    const update: Record<string, unknown> = { $set: changes };
    // $min on a missing field sets it; on an existing date it keeps the earlier one (the first publication).
    if (dto.status === PostStatus.PUBLISHED) update.$min = { publishedAt: new Date() };

    const post = await this.posts.findOneAndUpdate(filter, update, { new: true, runValidators: true });
    if (!post) throw new NotFoundException('Post not found');
    return PostResponseDto.from(post);
  }

  /** BLG-04: the author deletes their own post; its comments and likes go with it. 404 for anyone else's. */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    await this.deletePostAndDependents(this.ownedFilter(id, actor));
  }

  /**
   * Deletes the post matching `filter`, then its dependents. Reusable for an admin delete (GEN-10):
   * pass a filter on `_id` only. The post goes first, so a half-finished cascade leaves only orphans
   * that nothing can reach any more.
   *
   * ASSUMPTION for BLG-05 / BLG-06: likes and comments live in collections named `likes` and `comments`
   * and point at the post with an ObjectId field `postId`. Going through the raw collection keeps this a
   * harmless no-op while those modules do not exist. If their schemas differ, change DEPENDENT_COLLECTIONS
   * and the field below.
   * LIMITATION: not wrapped in a MongoDB transaction (standalone servers and the in-memory test server
   * do not support them), so the post delete and the cascade are not atomic.
   */
  async deletePostAndDependents(filter: FilterQuery<Post>): Promise<void> {
    const post = await this.posts.findOneAndDelete(filter).select('_id').lean();
    if (!post) throw new NotFoundException('Post not found');
    for (const name of DEPENDENT_COLLECTIONS) {
      await this.connection.collection(name).deleteMany({ postId: post._id });
    }
  }

  // A malformed id can never match, so it gets the same 404 as an unknown one (no CastError reaches the client).
  private ownedFilter(id: string, actor: AuthenticatedUser): FilterQuery<Post> {
    if (!/^[0-9a-f]{24}$/i.test(id)) throw new NotFoundException('Post not found');
    return { _id: new Types.ObjectId(id), authorId: new Types.ObjectId(actor.userId) };
  }

  private assertLimit(field: string, items: unknown[] | undefined, max: number): void {
    if (items && items.length > max) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field, message: `A post can have at most ${max} ${field}` }],
      });
    }
  }
}
