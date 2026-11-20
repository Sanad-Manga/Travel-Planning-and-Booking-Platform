import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { TAG_MAX_LENGTH } from '../../common';

/** Path parameter of GET /api/tags/:tag/posts (BLG-08). Tags are stored trimmed and lower-case, so it is matched the same way. */
export class TagParamDto {
  @ApiProperty({ example: 'cairo', maxLength: TAG_MAX_LENGTH, description: 'Tag to list posts for (case-insensitive).' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_MAX_LENGTH)
  tag: string;
}
