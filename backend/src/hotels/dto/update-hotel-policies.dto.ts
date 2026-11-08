import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { HOTEL_MAX_CANCELLATION_TIERS, HOTEL_MAX_TIER_DAYS } from '../hotels.constants';

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
 * PUT /api/hotels/:id/policies (HTL-10). Replaces the whole list. HTL-09 adds the check-in/check-out times to
 * this same body later; keep this field and add the others next to it.
 */
export class UpdateHotelPoliciesDto {
  @ApiProperty({
    type: [CancellationTierDto],
    maxItems: HOTEL_MAX_CANCELLATION_TIERS,
    description: 'The full list of tiers. [] = no refunds. No two tiers may share a daysBeforeThreshold.',
    example: [
      { daysBeforeThreshold: 14, refundPercent: 100 },
      { daysBeforeThreshold: 7, refundPercent: 50 },
      { daysBeforeThreshold: 0, refundPercent: 0 },
    ],
  })
  @IsArray()
  @ArrayMaxSize(HOTEL_MAX_CANCELLATION_TIERS)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers: CancellationTierDto[];
}
