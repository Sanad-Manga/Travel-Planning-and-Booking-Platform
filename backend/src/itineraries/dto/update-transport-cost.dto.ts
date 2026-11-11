import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransportMode } from '../schemas/transport-cost.schema';
import {
  TransportAmountRules,
  TransportCityRules,
  TransportCurrencyRules,
  TransportDayRules,
  TransportModeRules,
} from './create-transport-cost.dto';
import { IfSent } from './create-itinerary-day.dto';

/**
 * Body of PATCH /api/transport-costs/:id (ITN-16). Send at least one field (checked in the service). Written out
 * instead of PartialType, because PartialType's @IsOptional() would let `null` through unvalidated; here a
 * `null` is validated and rejected, so nothing can be cleared.
 */
export class UpdateTransportCostDto {
  @ApiPropertyOptional({ enum: TransportMode })
  @IfSent()
  @TransportModeRules()
  mode?: TransportMode;

  @ApiPropertyOptional({ example: 'cairo', description: 'Official city_id' })
  @IfSent()
  @TransportCityRules('fromCityId')
  fromCityId?: string;

  @ApiPropertyOptional({ example: 'luxor', description: 'Official city_id' })
  @IfSent()
  @TransportCityRules('toCityId')
  toCityId?: string;

  @ApiPropertyOptional({ example: 18000, minimum: 0 })
  @IfSent()
  @TransportAmountRules()
  amountCents?: number;

  @ApiPropertyOptional({ example: 'EGP' })
  @IfSent()
  @TransportCurrencyRules()
  currency?: string;

  @ApiPropertyOptional({
    example: '674a1b2c3d4e5f6a7b8c9d10',
    description: 'Another day of the same itinerary',
  })
  @IfSent()
  @TransportDayRules()
  dayId?: string;
}
