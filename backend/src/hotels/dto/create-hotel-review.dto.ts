import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  HOTEL_REVIEW_MAX_LENGTH,
  HOTEL_REVIEW_MAX_RATING,
  HOTEL_REVIEW_MIN_RATING,
} from '../hotels.constants';

export class CreateHotelReviewDto {
  @ApiProperty({
    example: 5,
    minimum: HOTEL_REVIEW_MIN_RATING,
    maximum: HOTEL_REVIEW_MAX_RATING,
  })
  @IsInt()
  @Min(HOTEL_REVIEW_MIN_RATING)
  @Max(HOTEL_REVIEW_MAX_RATING)
  rating: number;

  @ApiPropertyOptional({
    example: 'Clean rooms and a great view of the Nile.',
    maxLength: HOTEL_REVIEW_MAX_LENGTH,
    description:
      'Optional written review. Leading and trailing whitespace is removed.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(HOTEL_REVIEW_MAX_LENGTH)
  comment?: string | null;
}
