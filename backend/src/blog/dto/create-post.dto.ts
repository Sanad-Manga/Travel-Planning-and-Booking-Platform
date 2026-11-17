import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { MAX_IMAGES_PER_ENTITY, POST_MAX_TAGS, PostStatus, TAG_MAX_LENGTH } from '../../common';
import { POST_BODY_MAX_LENGTH, POST_TITLE_MAX_LENGTH } from '../blog.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Trim, lower-case, drop blanks and duplicates ("Beach", " beach ") before validation.
const cleanTags = ({ value }: { value: unknown }) => {
  if (!Array.isArray(value)) return value;
  const seen = new Set<unknown>();
  return value
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v))
    .filter((v) => {
      if (v === '') return false;
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
};

export class PostImageDto {
  @ApiProperty({ description: 'Server-generated upload ID returned by the post image endpoint (BLG-10).', example: '6730a1f2c3d4e5f607182931' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  id: string;

  @ApiProperty({
    description: 'Backend-relative public image URL returned by the shared UploadService.',
    example: '/uploads/6730a1f2c3d4e5f607182931.jpg',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  // Retained response/legacy representation; create/update cannot attach client-provided references.
  @Matches(/^\/uploads\/(?!.*\.\.)[\w\-./]+$/, { message: 'url must be an upload path such as /uploads/posts/photo.jpg' })
  url: string;
}

export class CreatePostDto {
  @ApiProperty({ example: 'Three days in Cairo', maxLength: POST_TITLE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_TITLE_MAX_LENGTH)
  title: string;

  @ApiProperty({ example: 'We started at the pyramids...', maxLength: POST_BODY_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_BODY_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: POST_MAX_TAGS,
    description: `Trimmed, lower-cased and de-duplicated. Max ${POST_MAX_TAGS} tags of ${TAG_MAX_LENGTH} characters.`,
    example: ['cairo', 'budget'],
  })
  @IsOptional()
  @Transform(cleanTags)
  @IsArray()
  @ArrayMaxSize(POST_MAX_TAGS)
  @IsString({ each: true })
  @MaxLength(TAG_MAX_LENGTH, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [PostImageDto], maxItems: 0, deprecated: true, description: 'Legacy input: only omitted/empty on create; any provided images field is rejected on PATCH. Use POST/DELETE /posts/:id/images instead.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES_PER_ENTITY)
  @ValidateNested({ each: true })
  @Type(() => PostImageDto)
  images?: PostImageDto[];

  @ApiPropertyOptional({ enum: PostStatus, default: PostStatus.DRAFT, description: 'DRAFT is private; PUBLISHED is public. Defaults to DRAFT.' })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}
