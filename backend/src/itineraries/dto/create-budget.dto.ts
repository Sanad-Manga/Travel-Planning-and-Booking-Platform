import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PLATFORM_CURRENCY } from '../../common';
import { BudgetCategory } from '../schemas/budget.schema';
import {
  TransportAmountRules,
  TransportCurrencyRules,
} from './create-transport-cost.dto';

/** The rule for the category: one of the four allowed. */
export const BudgetCategoryRules = () =>
  applyDecorators(
    IsEnum(BudgetCategory, {
      message: `category must be one of: ${Object.values(BudgetCategory).join(', ')}`,
    }),
  );

/**
 * Body of POST /api/itineraries/:id/days/:dayId/budgets (ITN-14). The itinerary and the day come from the URL and
 * the owner from the login, never from the body. The amount and currency rules are the ones of the transport
 * cost entries (ITN-16): a non-negative whole number of cents and a 3-letter code that must be supported.
 */
export class CreateBudgetDto {
  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.FOOD })
  @BudgetCategoryRules()
  category: BudgetCategory;

  @ApiProperty({
    example: 2500,
    minimum: 0,
    description: 'Amount in integer cents of `currency`. 0 is allowed.',
  })
  @TransportAmountRules()
  amountCents: number;

  @ApiPropertyOptional({
    example: 'USD',
    default: PLATFORM_CURRENCY,
    description:
      'The currency the amount is in: a supported currency code, lower case is accepted. The platform currency when not sent.',
  })
  @IsOptional()
  @TransportCurrencyRules()
  currency?: string;
}
