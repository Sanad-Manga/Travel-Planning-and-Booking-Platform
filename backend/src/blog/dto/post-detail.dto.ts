import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Post } from '../schemas/post.schema';
import { CommentResponseDto } from './comment-response.dto';
import { PostImageDto } from './create-post.dto';
import { PostAuthorDto } from './post-list-row.dto';

/** GET /api/posts/:id (BLG-02): the full post page. */
export class PostDetailDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({ example: 'Three days in Cairo' })
  title: string;

  @ApiProperty({ type: PostAuthorDto })
  author: PostAuthorDto;

  @ApiProperty()
  body: string;

  @ApiProperty({ type: [String], example: ['cairo'] })
  tags: string[];

  @ApiProperty({ type: [PostImageDto] })
  images: PostImageDto[];

  @ApiPropertyOptional({
    example: '2026-11-20T14:30:00.000Z',
    description: 'Set when the post is published.',
  })
  publishedAt?: string;

  @ApiProperty({ example: '2026-11-20T14:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: 0 })
  likeCount: number;

  @ApiProperty({ example: 0 })
  commentCount: number;

  @ApiProperty({
    type: [CommentResponseDto],
    description:
      'First page of visible comments, oldest first. Logged-in users can retrieve further pages through GET /api/posts/:id/comments.',
  })
  comments: CommentResponseDto[];

  static fromLean(
    doc: Post & { _id: { toString(): string } },
    authorName: string,
    comments: CommentResponseDto[] = [],
  ): PostDetailDto {
    return {
      id: doc._id.toString(),
      title: doc.title,
      author: { id: doc.authorId.toString(), name: authorName },
      body: doc.body,
      tags: [...(doc.tags ?? [])],
      images: (doc.images ?? []).map((i) => ({ id: i.id, url: i.url })),
      ...(doc.publishedAt
        ? { publishedAt: doc.publishedAt.toISOString() }
        : {}),
      createdAt: (doc.createdAt ?? new Date(0)).toISOString(),
      likeCount: doc.likeCount ?? 0,
      commentCount: doc.commentCount ?? 0,
      comments,
    };
  }
}
