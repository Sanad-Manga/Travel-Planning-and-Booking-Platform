import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto, TAG_MAX_LENGTH } from '../../common';
import { POST_SEARCH_MAX_LENGTH } from '../blog.constants';

/** BLG-02 / BLG-09 query: GET /api/posts?tag=cairo&q=food&page=1&limit=10 */
export class BrowsePostsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'Only posts with this tag (case-insensitive).',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_MAX_LENGTH)
  tag?: string;

  @ApiPropertyOptional({
    example: 'cairo food',
    maxLength: POST_SEARCH_MAX_LENGTH,
    description:
      'Search keyword (BLG-09). Every word must appear, case-insensitive, in the title, a tag or the author name. Blank means no search. With a search, posts are ordered by likes + comments, highest first, then newest first.',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const text = value.trim();
    return text === '' ? undefined : text;
  })
  @IsOptional()
  @IsString()
  @MaxLength(POST_SEARCH_MAX_LENGTH)
  q?: string;
}
