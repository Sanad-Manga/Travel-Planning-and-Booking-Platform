import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  HOTEL_REVIEW_MAX_LENGTH,
  HOTEL_REVIEW_MAX_RATING,
  HOTEL_REVIEW_MIN_RATING,
} from '../hotels.constants';

export class UpdateHotelReviewDto {
  @ApiPropertyOptional({
    example: 4,
    minimum: HOTEL_REVIEW_MIN_RATING,
    maximum: HOTEL_REVIEW_MAX_RATING,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(HOTEL_REVIEW_MIN_RATING)
  @Max(HOTEL_REVIEW_MAX_RATING)
  rating?: number;

  @ApiPropertyOptional({
    example: 'The staff was very welcoming.',
    maxLength: HOTEL_REVIEW_MAX_LENGTH,
    description:
      'Optional written review. Leading and trailing whitespace is removed.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(HOTEL_REVIEW_MAX_LENGTH)
  comment?: string;
}
