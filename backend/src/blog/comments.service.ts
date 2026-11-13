import {
  BadRequestException,
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
import { UsersService } from '../users/users.service';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
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

    const author = await this.users.findById(actor.userId);
    const authorName =
      !author || author.status === AccountStatus.DEACTIVATED
        ? 'Deleted user'
        : author.name;

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
}