import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { HOTEL_MAX_CANCELLATION_TIERS, HOTEL_MAX_TIER_DAYS, HOTEL_TIME_OF_DAY_PATTERN } from '../hotels.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
// "Validate when sent": an omitted field is skipped, but null (or anything else) still has to pass.
const whenSent = (_: unknown, value: unknown) => value !== undefined;

export class CancellationTierDto {
  @ApiProperty({
    description: 'Cancelling at least this many whole days before check-in earns this tier. 0 = up to the check-in day. Unique within the hotel.',
    minimum: 0,
    maximum: HOTEL_MAX_TIER_DAYS,
    example: 7,
  })
  @IsInt()
  @Min(0)
  @Max(HOTEL_MAX_TIER_DAYS)
  daysBeforeThreshold: number;

  @ApiProperty({ description: 'Share of the booking total that is refunded, 0-100.', minimum: 0, maximum: 100, example: 50 })
  @IsInt()
  @Min(0)
  @Max(100)
  refundPercent: number;
}

/**
 * PUT /api/hotels/:id/policies (HTL-09 + HTL-10). Send any subset of the fields, at least one. A field that is not
 * sent keeps its stored value, so saving the times never wipes the cancellation tiers and vice versa.
 */
export class UpdateHotelPoliciesDto {
  @ApiPropertyOptional({
    type: [CancellationTierDto],
    maxItems: HOTEL_MAX_CANCELLATION_TIERS,
    description: 'The full list of tiers (replaces the stored list). [] = no refunds. No two tiers may share a daysBeforeThreshold.',
    example: [
      { daysBeforeThreshold: 14, refundPercent: 100 },
      { daysBeforeThreshold: 7, refundPercent: 50 },
      { daysBeforeThreshold: 0, refundPercent: 0 },
    ],
  })
  @ValidateIf(whenSent)
  @IsArray()
  @ArrayMaxSize(HOTEL_MAX_CANCELLATION_TIERS)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers?: CancellationTierDto[];

  @ApiPropertyOptional({ description: 'Standard check-in time, 24-hour HH:mm in the hotel\'s local time.', example: '14:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @Matches(HOTEL_TIME_OF_DAY_PATTERN, { message: 'checkInTime must be a time in 24-hour HH:mm format, for example 14:00' })
  checkInTime?: string;

  @ApiPropertyOptional({ description: 'Standard check-out time, 24-hour HH:mm in the hotel\'s local time.', example: '11:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })
  @ValidateIf(whenSent)
  @Transform(trim)
  @IsString()
  @Matches(HOTEL_TIME_OF_DAY_PATTERN, { message: 'checkOutTime must be a time in 24-hour HH:mm format, for example 11:00' })
  checkOutTime?: string;
}
