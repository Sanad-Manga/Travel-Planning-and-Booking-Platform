import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { HOTEL_REVIEW_REPLY_MAX_LENGTH } from '../hotels.constants';

export class ReplyToHotelReviewDto {
  @ApiProperty({
    example: 'Thank you for staying with us! We hope to welcome you again soon.',
    maxLength: HOTEL_REVIEW_REPLY_MAX_LENGTH,
    description: 'Leading and trailing whitespace is removed. Replaces any previous reply.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_REVIEW_REPLY_MAX_LENGTH)
  reply: string;
}
