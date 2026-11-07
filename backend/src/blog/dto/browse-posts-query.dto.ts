import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto, TAG_MAX_LENGTH } from '../../common';

/** BLG-02 query: GET /api/posts?tag=cairo&page=1&limit=10 */
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
}
