import { ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetCategory } from '../schemas/budget.schema';
import { BudgetCategoryRules } from './create-budget.dto';
import { IfSent } from './create-itinerary-day.dto';
import {
  TransportAmountRules,
  TransportCurrencyRules,
} from './create-transport-cost.dto';

/**
 * Body of PATCH /api/budgets/:id (ITN-14). Send at least one field (checked in the service). Written out instead of
 * PartialType, because PartialType's @IsOptional() would let `null` through unvalidated; here a `null` is
 * validated and rejected, so nothing can be cleared. The day cannot be changed: delete the entry and add it to
 * the other day.
 */
export class UpdateBudgetDto {
  @ApiPropertyOptional({ enum: BudgetCategory })
  @IfSent()
  @BudgetCategoryRules()
  category?: BudgetCategory;

  @ApiPropertyOptional({ example: 2500, minimum: 0 })
  @IfSent()
  @TransportAmountRules()
  amountCents?: number;

  @ApiPropertyOptional({ example: 'EUR' })
  @IfSent()
  @TransportCurrencyRules()
  currency?: string;
}
