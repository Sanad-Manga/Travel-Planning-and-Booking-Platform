import { ApiProperty } from '@nestjs/swagger';
import { Post } from '../schemas/post.schema';

export class PostAuthorDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182900' })
  id: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  name: string;
}

/** One row of GET /api/posts (BLG-02). No body or images, so the list stays light. */
export class PostListRowDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({ example: 'Three days in Cairo' })
  title: string;

  @ApiProperty({ type: PostAuthorDto })
  author: PostAuthorDto;

  @ApiProperty({ type: [String], example: ['cairo'] })
  tags: string[];

  @ApiProperty({
    example: '2026-11-20T14:30:00.000Z',
    description: 'When the post was published.',
  })
  publishedAt: string;

  @ApiProperty({ example: 0 })
  likeCount: number;

  @ApiProperty({ example: 0 })
  commentCount: number;

  /** Maps a lean Mongo document. The author name is filled in by BlogService (one lookup per page). */
  static fromLean(doc: Post & { _id: { toString(): string } }): PostListRowDto {
    return {
      id: doc._id.toString(),
      title: doc.title,
      author: { id: doc.authorId.toString(), name: '' },
      tags: [...(doc.tags ?? [])],
      publishedAt: (
        doc.publishedAt ??
        doc.createdAt ??
        new Date(0)
      ).toISOString(),
      likeCount: doc.likeCount ?? 0,
      commentCount: doc.commentCount ?? 0,
    };
  }
}
