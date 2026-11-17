import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import {
  AccountStatus,
  AuthenticatedUser,
  COMMENT_MAX_LENGTH,
  paginate,
  PaginatedResponse,
  PaginationDto,
  PostStatus,
  Role,
} from '../common';
import { isOwner } from '../common/ownership';
import { UsersService } from '../users/users.service';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { Comment } from './schemas/comment.schema';
import { Post } from './schemas/post.schema';

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name)
    private readonly comments: Model<Comment>,
    @InjectModel(Post.name)
    private readonly posts: Model<Post>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly users: UsersService,
  ) {}

  async create(
    postId: string,
    dto: CreateCommentDto,
    actor: AuthenticatedUser,
  ): Promise<CommentResponseDto> {
    if (typeof dto.body !== 'string') {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          { field: 'body', message: 'Comment must be a string' },
        ],
      });
    }

    const body = dto.body.trim();

    if (body.length === 0 || body.length > COMMENT_MAX_LENGTH) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          {
            field: 'body',
            message: `Comment must contain between 1 and ${COMMENT_MAX_LENGTH} characters`,
          },
        ],
      });
    }

    if (!/^[0-9a-f]{24}$/i.test(postId)) {
      throw new NotFoundException('Post not found');
    }

    const authorName = await this.authorName(actor.userId);

    return this.connection.transaction(async (session) => {
      const result = await this.posts.updateOne(
        {
          _id: new Types.ObjectId(postId),
          status: PostStatus.PUBLISHED,
          isHidden: false,
        },
        { $inc: { commentCount: 1 } },
        { session },
      );

      if (result.matchedCount === 0) {
        throw new NotFoundException('Post not found');
      }

      const [comment] = await this.comments.create(
        [
          {
            postId: new Types.ObjectId(postId),
            authorId: new Types.ObjectId(actor.userId),
            body,
            isHidden: false,
          },
        ],
        { session },
      );

      return CommentResponseDto.from(comment, authorName);
    });
  }

  async list(
    postId: string,
    query: PaginationDto,
    viewer?: AuthenticatedUser,
  ): Promise<PaginatedResponse<CommentResponseDto>> {
    if (!/^[0-9a-f]{24}$/i.test(postId)) {
      throw new NotFoundException('Post not found');
    }

    const post = await this.posts
      .findOne({
        _id: new Types.ObjectId(postId),
        status: PostStatus.PUBLISHED,
      })
      .select('authorId isHidden')
      .lean()
      .exec();

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const isAdmin = viewer?.role === Role.ADMIN;
    const isPostAuthor = post.authorId.toString() === viewer?.userId;

    if (post.isHidden && !isAdmin && !isPostAuthor) {
      throw new NotFoundException('Post not found');
    }

    const filter: FilterQuery<Comment> = {
      postId: new Types.ObjectId(postId),
    };

    // Only a hidden comment's author and admins can see it.
    if (!isAdmin) {
      if (viewer) {
        filter.$or = [
          { isHidden: false },
          { authorId: new Types.ObjectId(viewer.userId) },
        ];
      } else {
        filter.isHidden = false;
      }
    }

    const page = await paginate(this.comments, filter, query, {
      sort: { createdAt: 1, _id: 1 },
      map: (comment: Comment & { _id: Types.ObjectId }) =>
        CommentResponseDto.from(comment, 'Deleted user'),
    });

    const authorIds = [
      ...new Set(page.items.map((comment) => comment.author.id)),
    ];

    const authors = await Promise.all(
      authorIds.map((id) => this.users.findById(id)),
    );

    const names = new Map<string, string>();

    authors.forEach((author, index) => {
      if (author && author.status !== AccountStatus.DEACTIVATED) {
        names.set(authorIds[index], author.name);
      }
    });

    return {
      ...page,
      items: page.items.map((comment) => ({
        ...comment,
        author: {
          id: comment.author.id,
          name: names.get(comment.author.id) ?? 'Deleted user',
        },
      })),
    };
  }

  /**
   * BLG-07: the author edits their own comment. The body rules (non-empty, at most COMMENT_MAX_LENGTH,
   * trimmed, no unknown fields) are the ones of CreateCommentDto, inherited by UpdateCommentDto.
   * The isHidden flag, the author and the post can never change here.
   */
  async update(
    id: string,
    dto: UpdateCommentDto,
    actor: AuthenticatedUser,
  ): Promise<CommentResponseDto> {
    const comment = await this.loadOwnComment(id, actor);

    if (comment.isHidden) {
      throw new ConflictException(
        'A comment hidden by a moderator cannot be edited',
      );
    }

    // The filter repeats the owner and not-hidden conditions, so a moderator hiding the comment between the
    // read above and this write wins: nothing is updated and the edit is refused.
    const updated = await this.comments.findOneAndUpdate(
      {
        _id: comment._id,
        authorId: new Types.ObjectId(actor.userId),
        isHidden: false,
      },
      { $set: { body: dto.body } },
      { new: true, runValidators: true },
    );

    if (!updated) {
      throw (await this.comments.exists({ _id: comment._id }))
        ? new ConflictException(
            'A comment hidden by a moderator cannot be edited',
          )
        : new NotFoundException('Comment not found');
    }

    return CommentResponseDto.from(updated, await this.authorName(actor.userId));
  }

  /**
   * BLG-07: the author deletes their own comment. Hard delete, like deleting a post (BLG-04): the document is
   * removed and the post's commentCount (which counts every stored comment, hidden or not, see create) goes
   * down by one in the same transaction, so the counter cannot drift.
   */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const comment = await this.loadOwnComment(id, actor);

    await this.connection.transaction(async (session) => {
      const result = await this.comments.deleteOne(
        { _id: comment._id, authorId: new Types.ObjectId(actor.userId) },
        { session },
      );

      // Already deleted by a concurrent request: nothing to count down.
      if (result.deletedCount === 0) {
        throw new NotFoundException('Comment not found');
      }

      await this.posts.updateOne(
        { _id: comment.postId, commentCount: { $gt: 0 } },
        { $inc: { commentCount: -1 } },
        { session },
      );
    });
  }

  /**
   * Shared by edit and delete: finds the comment and decides who may touch it.
   *  - malformed or unknown id, or the post is gone, a draft or hidden: 404 (the post rules of create/list);
   *  - someone else's comment: 403, because comments are public content and there is nothing to hide
   *    (contracts section 4: 404 is only for resources private to their owner). A hidden comment is only
   *    visible to its author and admins, so for anyone else it is a 404, which does not reveal it exists.
   *    An admin gets 403 too: removing others' comments is GEN-10, not this endpoint.
   */
  private async loadOwnComment(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Comment & { _id: Types.ObjectId }> {
    if (!/^[0-9a-f]{24}$/i.test(id)) {
      throw new NotFoundException('Comment not found');
    }

    const comment = await this.comments
      .findById(id)
      .lean<Comment & { _id: Types.ObjectId }>()
      .exec();

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const postVisible = await this.posts.exists({
      _id: comment.postId,
      status: PostStatus.PUBLISHED,
      isHidden: false,
    });

    if (!postVisible) {
      throw new NotFoundException('Comment not found');
    }

    if (!isOwner(actor, { ownerId: comment.authorId })) {
      if (comment.isHidden && actor.role !== Role.ADMIN) {
        throw new NotFoundException('Comment not found');
      }

      throw new ForbiddenException('You can only change your own comments');
    }

    return comment;
  }

  private async authorName(userId: string): Promise<string> {
    const author = await this.users.findById(userId);

    return !author || author.status === AccountStatus.DEACTIVATED
      ? 'Deleted user'
      : author.name;
  }
}