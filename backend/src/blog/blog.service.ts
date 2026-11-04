import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, MAX_IMAGES_PER_ENTITY, POST_MAX_TAGS, PostStatus } from '../common';
import { CreatePostDto } from './dto/create-post.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { Post } from './schemas/post.schema';

@Injectable()
export class BlogService {
  constructor(@InjectModel(Post.name) private readonly posts: Model<Post>) {}

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

  private assertLimit(field: string, items: unknown[] | undefined, max: number): void {
    if (items && items.length > max) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field, message: `A post can have at most ${max} ${field}` }],
      });
    }
  }
}
