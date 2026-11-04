import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostStatus } from '../../common';
import { PostDocument } from '../schemas/post.schema';
import { PostImageDto } from './create-post.dto';

export class PostResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182900' })
  authorId: string;

  @ApiProperty({ example: 'Three days in Cairo' })
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ type: [String], example: ['cairo'] })
  tags: string[];

  @ApiProperty({ type: [PostImageDto] })
  images: PostImageDto[];

  @ApiProperty({ enum: PostStatus })
  status: PostStatus;

  @ApiProperty({ description: 'true = hidden by moderation; visible only to the author and admins.' })
  isHidden: boolean;

  @ApiPropertyOptional({ example: '2026-11-20T14:30:00.000Z', description: 'Set when the post is published.' })
  publishedAt?: string;

  @ApiProperty({ example: '2026-11-20T14:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-20T14:30:00.000Z' })
  updatedAt: string;

  static from(post: PostDocument): PostResponseDto {
    return {
      id: post._id.toString(),
      authorId: post.authorId.toString(),
      title: post.title,
      body: post.body,
      tags: [...(post.tags ?? [])],
      images: (post.images ?? []).map((i) => ({ id: i.id, url: i.url })),
      status: post.status,
      isHidden: post.isHidden,
      ...(post.publishedAt ? { publishedAt: post.publishedAt.toISOString() } : {}),
      createdAt: (post.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (post.updatedAt ?? new Date(0)).toISOString(),
    };
  }
}
