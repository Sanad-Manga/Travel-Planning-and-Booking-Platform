import { ApiProperty } from '@nestjs/swagger';
import { Comment } from '../schemas/comment.schema';
import { PostAuthorDto } from './post-list-row.dto';

export class CommentResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182931' })
  id: string;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  postId: string;

  @ApiProperty({ type: PostAuthorDto })
  author: PostAuthorDto;

  @ApiProperty({ example: 'This helped me plan my trip!' })
  body: string;

  @ApiProperty({ example: '2026-11-11T17:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-11T17:30:00.000Z' })
  updatedAt: string;

  static from(
    comment: Comment & { _id: { toString(): string } },
    authorName: string,
  ): CommentResponseDto {
    return {
      id: comment._id.toString(),
      postId: comment.postId.toString(),
      author: {
        id: comment.authorId.toString(),
        name: authorName,
      },
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    };
  }
}