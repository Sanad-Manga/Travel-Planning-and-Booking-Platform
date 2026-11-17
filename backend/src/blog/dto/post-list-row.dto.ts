import { ApiProperty } from '@nestjs/swagger';
import { POST_EXCERPT_MAX_LENGTH } from '../blog.constants';
import { Post } from '../schemas/post.schema';

// How much raw body the database returns per row: more than the excerpt, because collapsing whitespace shrinks it.
const EXCERPT_SOURCE_LENGTH = POST_EXCERPT_MAX_LENGTH * 4;

/**
 * Projection for list rows: the body is cut in the database to EXCERPT_SOURCE_LENGTH characters and images
 * are left out, so a page never carries whole bodies.
 */
export const POST_LIST_ROW_PROJECTION = {
  authorId: 1,
  title: 1,
  tags: 1,
  publishedAt: 1,
  createdAt: 1,
  likeCount: 1,
  commentCount: 1,
  body: { $substrCP: ['$body', 0, EXCERPT_SOURCE_LENGTH] },
};

/** The first POST_EXCERPT_MAX_LENGTH characters, whitespace collapsed, with an ellipsis when the text goes on. */
export function makeExcerpt(body: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  const goesOn = text.length > POST_EXCERPT_MAX_LENGTH || body.length >= EXCERPT_SOURCE_LENGTH;
  return goesOn ? `${text.slice(0, POST_EXCERPT_MAX_LENGTH).trimEnd()}…` : text;
}

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

  @ApiProperty({
    example: 'Day one starts at the pyramids, then the old bazaar for lunch…',
    description: `First ${POST_EXCERPT_MAX_LENGTH} characters of the body, ending with an ellipsis when it was cut.`,
  })
  excerpt: string;

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
      excerpt: makeExcerpt(doc.body ?? ''),
      likeCount: doc.likeCount ?? 0,
      commentCount: doc.commentCount ?? 0,
    };
  }
}
