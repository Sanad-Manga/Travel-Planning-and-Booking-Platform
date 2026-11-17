import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, ProjectionType, Types } from 'mongoose';
import { AuthenticatedUser, DEFAULT_PAGE, DEFAULT_PAGE_SIZE, paginate, PaginatedResponse, PaginationDto, POST_MAX_TAGS, PostStatus, Role, toPaginated } from '../common';
import { UsersService } from '../users/users.service';
import { CommentsService } from './comments.service';
import { BrowsePostsQueryDto } from './dto/browse-posts-query.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { MyPostRowDto } from './dto/my-post-row.dto';
import { PostDetailDto } from './dto/post-detail.dto';
import { PostLikeResponseDto } from './dto/post-like-response.dto';
import { POST_LIST_ROW_PROJECTION, PostListRowDto } from './dto/post-list-row.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Like } from './schemas/like.schema';
import { Post } from './schemas/post.schema';
import { PostImagesService } from './post-images.service';

// See deletePostAndDependents for the assumption behind these names.
const DEPENDENT_COLLECTIONS = ['comments', 'likes'];

// Shown when an author's account can no longer be found.
const UNKNOWN_AUTHOR = 'Unknown user';

type LeanPost = Post & { _id: Types.ObjectId };

/** Makes user text safe inside a RegExp, so a keyword like "c++" or "(" is searched as plain text. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Like.name) private readonly likes: Model<Like>,
    @InjectConnection() private readonly connection: Connection,
    private readonly users: UsersService,
    private readonly commentsService: CommentsService,
    private readonly postImages: PostImagesService,
  ) {}

  /**
   * BLG-01: any logged-in user creates a post as DRAFT (default, private) or PUBLISHED.
   * The author is always the caller; isHidden always starts false. Neither can be sent in the body.
   */
  async create(dto: CreatePostDto, actor: AuthenticatedUser): Promise<PostResponseDto> {
    if (dto.images !== undefined && (!Array.isArray(dto.images) || dto.images.length !== 0)) {
      throw this.imageInputError();
    }
    // Limits re-checked here too, so they hold for any caller of the service (contracts section 3).
    this.assertLimit('tags', dto.tags, POST_MAX_TAGS);

    const status = dto.status ?? PostStatus.DRAFT;
    const post = await this.posts.create({
      authorId: new Types.ObjectId(actor.userId),
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      images: [],
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
   * BLG-02: the public list. Only PUBLISHED, not hidden posts, newest published first, optionally
   * filtered by one tag. Drafts and hidden posts can never appear here. Author names are looked up once
   * per page (one lookup per distinct author), not once per row.
   * BLG-09: with `q` it becomes a search, see searchPublished.
   */
  async listPublished(query: BrowsePostsQueryDto): Promise<PaginatedResponse<PostListRowDto>> {
    const filter: FilterQuery<Post> = { status: PostStatus.PUBLISHED, isHidden: false };
    if (query.tag) filter.tags = query.tag;
    if (query.q) return this.searchPublished(filter, query.q, query);

    const page = await paginate(this.posts, filter, query, {
      map: PostListRowDto.fromLean,
      sort: { publishedAt: -1, _id: -1 },
      // Mongoose's types do not know aggregation expressions in a find projection, MongoDB does.
      projection: POST_LIST_ROW_PROJECTION as unknown as ProjectionType<Post>,
    });

    const names = await this.authorNames(page.items.map((row) => row.author.id));
    return {
      ...page,
      items: page.items.map((row) => ({
        ...row,
        author: { id: row.author.id, name: names.get(row.author.id) ?? UNKNOWN_AUTHOR },
      })),
    };
  }

  /**
   * BLG-09: search the posts matched by `base` (always published and not hidden, so drafts and hidden posts
   * cannot appear). The keyword is split into words; every word must appear (case-insensitive, as plain text,
   * never as a regular expression) in the title, in one of the tags or in the author's name. The author name
   * lives in the users collection, so it is joined in the same aggregation (read only). Order: interaction
   * score (likeCount + commentCount) descending, then newest published first, then _id so pages are stable.
   * No match is an empty page, not an error.
   * LIMITATION: substring matching cannot use an index, so it scans the published posts; fine at this scale.
   */
  private async searchPublished(
    base: FilterQuery<Post>,
    keyword: string,
    pagination: Pick<PaginationDto, 'page' | 'limit'>,
  ): Promise<PaginatedResponse<PostListRowDto>> {
    const page = pagination.page ?? DEFAULT_PAGE;
    const limit = pagination.limit ?? DEFAULT_PAGE_SIZE;
    const words = keyword
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => new RegExp(escapeRegExp(word), 'i'));

    const [result] = await this.posts.aggregate<{
      items: (Post & { _id: Types.ObjectId; authorName?: string })[];
      total: { n: number }[];
    }>([
      { $match: base },
      { $lookup: { from: 'users', localField: 'authorId', foreignField: '_id', pipeline: [{ $project: { name: 1 } }], as: 'authorDocs' } },
      { $match: { $and: words.map((word) => ({ $or: [{ title: word }, { tags: word }, { 'authorDocs.name': word }] })) } },
      {
        $addFields: {
          score: { $add: [{ $ifNull: ['$likeCount', 0] }, { $ifNull: ['$commentCount', 0] }] },
          sortDate: { $ifNull: ['$publishedAt', '$createdAt'] },
          authorName: { $arrayElemAt: ['$authorDocs.name', 0] },
        },
      },
      { $sort: { score: -1, sortDate: -1, _id: -1 } },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: { ...POST_LIST_ROW_PROJECTION, authorName: 1 } }],
          total: [{ $count: 'n' }],
        },
      },
    ]);

    const items = result.items.map((doc) => ({
      ...PostListRowDto.fromLean(doc),
      author: { id: doc.authorId.toString(), name: doc.authorName ?? UNKNOWN_AUTHOR },
    }));
    return toPaginated(items, result.total[0]?.n ?? 0, page, limit);
  }

  /** BLG-08: clicking a tag lists its published, non-hidden posts. Same rules and rows as the public list. */
  listByTag(tag: string, query: PaginationDto): Promise<PaginatedResponse<PostListRowDto>> {
    return this.listPublished({ ...query, tag });
  }

  /**
   * BLG-02: open one post. `viewer` is the logged-in caller, or undefined for a guest.
   * Only PUBLISHED posts open here; a draft never does. A hidden post is visible only to its author
   * and admins (contracts section 7). Everyone else gets 404, never 403 (section 4).
   */
   async findOne(
    id: string,
    viewer?: AuthenticatedUser,
    query: PaginationDto = new PaginationDto(),
  ): Promise<PostDetailDto> {
    if (!/^[0-9a-f]{24}$/i.test(id)) {
      throw new NotFoundException('Post not found');
    }

    const post = await this.posts.findById(id).lean<LeanPost>().exec();

    if (!post || !this.canView(post, viewer)) {
      throw new NotFoundException('Post not found');
    }

    const authorId = post.authorId.toString();
    const names = await this.authorNames([authorId]);
    const comments = await this.commentsService.list(id, query, viewer);

    return PostDetailDto.fromLean(
      post,
      names.get(authorId) ?? UNKNOWN_AUTHOR,
      comments.items,
    );
  }

  async like(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PostLikeResponseDto> {
    const postId = this.postObjectId(id);
    const userId = new Types.ObjectId(actor.userId);
    const visiblePost: FilterQuery<Post> = {
      _id: postId,
      status: PostStatus.PUBLISHED,
      isHidden: false,
    };

    try {
      return await this.connection.transaction(async (session) => {
        const post = await this.posts
          .findOne(visiblePost)
          .select('_id')
          .session(session)
          .lean()
          .exec();

        if (!post) {
          throw new NotFoundException('Post not found');
        }

        await this.likes.create([{ postId, userId }], { session });

        const result = await this.posts.updateOne(
          visiblePost,
          { $inc: { likeCount: 1 } },
          { session },
        );

        if (result.matchedCount === 0) {
          throw new NotFoundException('Post not found');
        }

        const updatedPost = await this.posts
          .findById(postId)
          .select('likeCount')
          .session(session)
          .lean()
          .exec();

        if (!updatedPost) {
          throw new NotFoundException('Post not found');
        }

        return {
          postId: id,
          liked: true,
          likeCount: updatedPost.likeCount,
        };
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const [post, existingLike] = await Promise.all([
        this.posts.findOne(visiblePost).select('likeCount').lean().exec(),
        this.likes.findOne({ postId, userId }).select('_id').lean().exec(),
      ]);

      if (!post) {
        throw new NotFoundException('Post not found');
      }

      if (!existingLike) {
        throw error;
      }

      return {
        postId: id,
        liked: true,
        likeCount: post.likeCount,
      };
    }
  }

  async unlike(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PostLikeResponseDto> {
    const postId = this.postObjectId(id);
    const userId = new Types.ObjectId(actor.userId);

    return this.connection.transaction(async (session) => {
      const post = await this.posts
        .findById(postId)
        .select('_id')
        .session(session)
        .lean()
        .exec();

      if (!post) {
        throw new NotFoundException('Post not found');
      }

      const result = await this.likes.deleteOne(
        { postId, userId },
        { session },
      );

      if (result.deletedCount > 0) {
        const update = await this.posts.updateOne(
          { _id: postId, likeCount: { $gt: 0 } },
          { $inc: { likeCount: -1 } },
          { session },
        );

        if (update.matchedCount === 0) {
          throw new InternalServerErrorException(
            'Post like count is inconsistent',
          );
        }
      }

      const updatedPost = await this.posts
        .findById(postId)
        .select('likeCount')
        .session(session)
        .lean()
        .exec();

      if (!updatedPost) {
        throw new NotFoundException('Post not found');
      }

      return {
        postId: id,
        liked: false,
        likeCount: updatedPost.likeCount,
      };
    });
  }

  /**
   * BLG-04: the author edits their own post (hidden posts included). One atomic findOneAndUpdate
   * filtered by {_id, authorId}: someone else's, unknown or malformed id gives 404, never 403.
   * authorId, isHidden and the counters cannot be changed. publishedAt is set the first time the
   * post becomes PUBLISHED and kept afterwards (also if it goes back to DRAFT and is re-published).
   */
  async update(id: string, dto: UpdatePostDto, actor: AuthenticatedUser): Promise<PostResponseDto> {
    if (dto.images !== undefined) throw this.imageInputError();
    const changes: Partial<Record<'title' | 'body' | 'tags' | 'status', unknown>> = {};
    for (const key of ['title', 'body', 'tags', 'status'] as const) {
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
   * Delete using the caller's existing authorized filter (or an admin's _id filter):
   * load the post/image snapshot, clean managed images through target-scoped storage,
   * then conditionally delete the post only if that snapshot is unchanged.
   * Cleanup failure leaves the post available for retry; concurrent image changes
   * can prevent deletion and require retry. Filesystem and MongoDB are not atomic,
   * so interruption after unlink can leave references to removed files until retry.
   *
   * Only after parent deletion do we remove comments/likes by their ObjectId postId.
   * This existing dependent cascade remains nontransactional: failure after deleting
   * the parent can leave dependent orphans requiring reconciliation. No transaction,
   * rollback or new recovery architecture is introduced here.
   */
  async deletePostAndDependents(filter: FilterQuery<Post>): Promise<void> {
    let post;
    try { post = await this.posts.findOne(filter).select('_id images').lean().exec(); }
    catch { throw new InternalServerErrorException('Post could not be retrieved'); }
    if (!post) throw new NotFoundException('Post not found');
    // Retain the parent and its references until scoped storage cleanup succeeds.
    await this.postImages.removeStoredImages(post._id.toString(), post.images ?? []);
    let deleted;
    try {
      // A concurrently attached/removed image requires retry, never deleting a
      // parent whose newly added file was absent from our cleanup snapshot.
      deleted = await this.posts.findOneAndDelete({ ...filter, images: post.images === undefined ? { $exists: false } : post.images }).select('_id').lean().exec();
    } catch { throw new InternalServerErrorException('Post deletion outcome is uncertain'); }
    if (!deleted) {
      let exists;
      try { exists = await this.posts.exists(filter); }
      catch { throw new InternalServerErrorException('Post could not be verified'); }
      if (!exists) throw new NotFoundException('Post not found');
      throw new ConflictException('Post images changed; retry deletion');
    }
    for (const name of DEPENDENT_COLLECTIONS) {
      await this.connection.collection(name).deleteMany({ postId: post._id });
    }
  }

  /** Only published posts open here. A hidden one opens only for its author and admins. Drafts never open (the author uses /mine). */
  private canView(post: LeanPost, viewer?: AuthenticatedUser): boolean {
    if (post.status !== PostStatus.PUBLISHED) return false;
    if (!post.isHidden) return true;
    return viewer !== undefined && (viewer.role === Role.ADMIN || post.authorId.toString() === viewer.userId);
  }

  /** author id -> display name, one lookup per distinct author. Unknown authors are simply missing from the map. */
  private async authorNames(authorIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(authorIds)];
    const found = await Promise.all(unique.map((id) => this.users.findById(id)));
    const names = new Map<string, string>();
    found.forEach((user, index) => {
      if (user) names.set(unique[index], user.name);
    });
    return names;
  }

  // A malformed id can never match, so it gets the same 404 as an unknown one (no CastError reaches the client).
  private ownedFilter(id: string, actor: AuthenticatedUser): FilterQuery<Post> {
    if (!/^[0-9a-f]{24}$/i.test(id)) throw new NotFoundException('Post not found');
    return { _id: new Types.ObjectId(id), authorId: new Types.ObjectId(actor.userId) };
  }

  private postObjectId(id: string): Types.ObjectId {
    if (!/^[0-9a-f]{24}$/i.test(id)) {
      throw new NotFoundException('Post not found');
    }
    return new Types.ObjectId(id);
  }

  private assertLimit(field: string, items: unknown[] | undefined, max: number): void {
    if (items && items.length > max) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field, message: `A post can have at most ${max} ${field}` }],
      });
    }
  }

  private imageInputError(): BadRequestException {
    return new BadRequestException({ message: 'Validation failed', details: [{ field: 'images', message: 'Use the post image upload/removal endpoints; direct image references are not accepted' }] });
  }
}
