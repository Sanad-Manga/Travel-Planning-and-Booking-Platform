import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostStatus } from '../../common';
import { Post } from '../schemas/post.schema';

/** One row of GET /api/posts/mine (BLG-03). No body or images, so the list stays light. */
export class MyPostRowDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({ example: 'Three days in Cairo' })
  title: string;

  @ApiProperty({ enum: PostStatus })
  status: PostStatus;

  @ApiProperty({
    description: 'true = hidden by moderation (still visible to its author).',
  })
  isHidden: boolean;

  @ApiProperty({
    example: '2026-11-20T14:30:00.000Z',
    description: 'When the post was created.',
  })
  createdAt: string;

  @ApiPropertyOptional({
    example: '2026-11-21T09:00:00.000Z',
    description: 'Set when the post is published.',
  })
  publishedAt?: string;

  @ApiProperty({ example: 0 })
  likeCount: number;

  @ApiProperty({ example: 0 })
  commentCount: number;

  /** Maps a lean (plain) Mongo document; paginate() uses lean(), so there is no hydrated document here. */
  static fromLean(doc: Post & { _id: { toString(): string } }): MyPostRowDto {
    return {
      id: doc._id.toString(),
      title: doc.title,
      status: doc.status,
      isHidden: doc.isHidden,
      createdAt: (doc.createdAt ?? new Date(0)).toISOString(),
      ...(doc.publishedAt
        ? { publishedAt: doc.publishedAt.toISOString() }
        : {}),
      likeCount: doc.likeCount ?? 0,
      commentCount: doc.commentCount ?? 0,
    };
  }
}
