import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const AIRLINE_MAX_CANCELLATION_TIERS = 20;
export const AIRLINE_MAX_TIER_DAYS = 365;

export class AirlineCancellationTierDto {
  @ApiProperty({
    description:
      'Cancelling at least this many whole days before departure earns this tier. 0 = up to the departure day. Unique within the airline.',
    minimum: 0,
    maximum: AIRLINE_MAX_TIER_DAYS,
    example: 7,
  })
  @IsInt({ message: 'daysBeforeThreshold must be a whole number' })
  @Min(0, { message: 'daysBeforeThreshold must be 0 or more' })
  @Max(AIRLINE_MAX_TIER_DAYS, {
    message: `daysBeforeThreshold must be at most ${AIRLINE_MAX_TIER_DAYS}`,
  })
  daysBeforeThreshold: number;

  @ApiProperty({
    description: 'Share of the booking total that is refunded, 0-100.',
    minimum: 0,
    maximum: 100,
    example: 50,
  })
  @IsInt({ message: 'refundPercent must be a whole number' })
  @Min(0, { message: 'refundPercent must be 0 or more' })
  @Max(100, { message: 'refundPercent must be at most 100' })
  refundPercent: number;
}

/** Body of PUT /api/airlines/:id/cancellation-policy. The list replaces the stored one. */
export class SetCancellationPolicyDto {
  @ApiProperty({
    type: [AirlineCancellationTierDto],
    maxItems: AIRLINE_MAX_CANCELLATION_TIERS,
    description:
      'The full list of tiers (replaces the stored list). [] = no refunds. No two tiers may share a daysBeforeThreshold.',
    example: [
      { daysBeforeThreshold: 14, refundPercent: 100 },
      { daysBeforeThreshold: 7, refundPercent: 50 },
      { daysBeforeThreshold: 0, refundPercent: 0 },
    ],
  })
  @IsArray({ message: 'cancellationTiers must be an array' })
  @ArrayMaxSize(AIRLINE_MAX_CANCELLATION_TIERS, {
    message: `cancellationTiers must have at most ${AIRLINE_MAX_CANCELLATION_TIERS} tiers`,
  })
  @ValidateNested({ each: true })
  @Type(() => AirlineCancellationTierDto)
  cancellationTiers: AirlineCancellationTierDto[];
}

export class CancellationPolicyResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' })
  airlineId: string;

  @ApiProperty({
    type: [AirlineCancellationTierDto],
    description:
      'Largest threshold first. The refund amount is calculated by Payments (RefundCalculator), not here.',
  })
  cancellationTiers: AirlineCancellationTierDto[];
}
