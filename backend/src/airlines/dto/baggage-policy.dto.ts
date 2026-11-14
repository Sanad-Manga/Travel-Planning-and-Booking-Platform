import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common';

/**
 * Body of PUT /api/airlines/:id/baggage-policy. Both fields are required: a PUT replaces the whole policy.
 * The weight limit of an extra bag is not sent: it is the max bag weight of the cabin the passenger flies in.
 */
export class SetBaggagePolicyDto {
  @ApiProperty({
    example: 3000,
    minimum: 1,
    description: 'Price of ONE extra bag in integer cents (> 0): 3000 = 30.00',
  })
  @IsInt({ message: 'extraBagPriceCents must be a whole number of cents' })
  @Min(1, { message: 'extraBagPriceCents must be greater than 0' })
  extraBagPriceCents: number;

  @ApiProperty({
    example: 2,
    minimum: 0,
    description:
      'Most extra bags one passenger may add (0 = extra bags not offered)',
  })
  @IsInt({ message: 'maxExtraBags must be a whole number' })
  @Min(0, { message: 'maxExtraBags must be 0 or more' })
  @Max(10, { message: 'maxExtraBags must be at most 10' })
  maxExtraBags: number;
}

export class BaggagePolicyResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' })
  airlineId: string;

  @ApiProperty({
    example: 3000,
    description: 'Price of one extra bag, integer cents',
  })
  extraBagPriceCents: number;

  @ApiProperty({ example: PLATFORM_CURRENCY })
  currency: string;

  @ApiProperty({ example: 2 })
  maxExtraBags: number;

  @ApiProperty({
    example:
      "Each extra bag may weigh at most the maxBagWeightKg of the passenger's cabin",
    description:
      'Reminder for clients: there is no separate extra-bag weight, it equals the cabin free-baggage limit (FLT-04)',
  })
  extraBagWeightRule: string;
}

export const EXTRA_BAG_WEIGHT_RULE =
  "Each extra bag may weigh at most the maxBagWeightKg of the passenger's cabin";
