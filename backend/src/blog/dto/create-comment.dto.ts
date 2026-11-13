import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { COMMENT_MAX_LENGTH } from '../../common';

export class CreateCommentDto {
  @ApiProperty({
    example: 'This helped me plan my trip!',
    description: 'Comment text. Leading and trailing whitespace is removed.',
    minLength: 1,
    maxLength: COMMENT_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Comment must not be empty' })
  @MaxLength(COMMENT_MAX_LENGTH, {
    message: 'Comment must be at most 500 characters',
  })
  body: string;
}