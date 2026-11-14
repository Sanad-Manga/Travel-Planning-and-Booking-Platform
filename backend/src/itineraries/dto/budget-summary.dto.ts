import { ApiProperty } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../common';
import { BudgetCategory } from '../schemas/budget.schema';
import { ActivityDto } from './activity.dto';
import { BudgetDto } from './budget.dto';
import { TransportCostDto } from './transport-cost.dto';

/**
 * The lines of the summary: the four categories of a budget entry, then the intercity transport entries (ITN-16),
 * which are not a budget category but are part of the trip's cost.
 */
export const INTERCITY_TRANSPORT = 'INTERCITY_TRANSPORT';
export type SummaryCategory = BudgetCategory | typeof INTERCITY_TRANSPORT;
export const SUMMARY_CATEGORIES: SummaryCategory[] = [
  ...Object.values(BudgetCategory),
  INTERCITY_TRANSPORT,
];

export class BudgetCategoryTotalDto {
  @ApiProperty({
    enum: SUMMARY_CATEGORIES,
    example: BudgetCategory.FOOD,
    description:
      'A budget category, or INTERCITY_TRANSPORT for the transport cost entries (ITN-16). Activity costs (ITN-10) are counted under ACTIVITIES.',
  })
  category: SummaryCategory;

  @ApiProperty({ example: 3200, description: 'Total in cents of the currency' })
  totalCents: number;
}

export class BudgetDayTotalDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d10' })
  dayId: string;

  @ApiProperty({ example: 1 })
  dayNumber: number;

  @ApiProperty({ example: '2026-12-20', description: 'YYYY-MM-DD' })
  date: string;

  @ApiProperty({
    example: 15000,
    description: 'Total in cents of the currency',
  })
  totalCents: number;
}

export class BudgetCurrencyTotalDto {
  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    example: 15700,
    description:
      'Grand total in cents of this currency. The category totals add up to it, and so do the day totals.',
  })
  totalCents: number;

  @ApiProperty({
    type: [BudgetCategoryTotalDto],
    description:
      'Total by category: always every line, in the same order, with 0 where nothing was spent',
  })
  byCategory: BudgetCategoryTotalDto[];

  @ApiProperty({
    type: [BudgetDayTotalDto],
    description: 'Total by day: every day of the itinerary, in order',
  })
  byDay: BudgetDayTotalDto[];
}

export class BudgetSummaryDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  itineraryId: string;

  @ApiProperty({
    example: PLATFORM_CURRENCY,
    description:
      'The platform currency. Activity costs are always in it. Its totals come first.',
  })
  platformCurrency: string;

  @ApiProperty({
    type: [BudgetCurrencyTotalDto],
    description:
      'One block per currency used. Amounts in different currencies are NOT added together here: the raw totals and their currency are exposed so the FX service (ITN-18) can convert them. Empty when the itinerary has no cost yet.',
  })
  totals: BudgetCurrencyTotalDto[];
}

/** The part of a day the summary needs. `ItineraryDayDto` fits. */
export interface SummaryDay {
  id: string;
  dayNumber: number;
  date: string;
}

/**
 * Adds up everything that costs money on an itinerary, per currency: the daily budget entries (ITN-14), the
 * activity costs (ITN-10, platform currency, counted as ACTIVITIES) and the intercity transport entries
 * (ITN-16). Calculated on every read, never stored, so it cannot go out of date.
 *
 * A cost whose day is no longer one of the itinerary's days is ignored everywhere, so the totals by category and
 * the totals by day are always the same grand total.
 */
export function buildBudgetSummary(
  itineraryId: string,
  days: SummaryDay[],
  activities: ActivityDto[],
  transportCosts: TransportCostDto[],
  budgets: BudgetDto[],
): BudgetSummaryDto {
  const costs: {
    dayId: string;
    category: SummaryCategory;
    cents: number;
    currency: string;
  }[] = [];
  for (const budget of budgets) {
    costs.push({
      dayId: budget.dayId,
      category: budget.category,
      cents: budget.amountCents,
      currency: budget.currency,
    });
  }
  for (const activity of activities) {
    if (activity.costCents === null) continue;
    costs.push({
      dayId: activity.dayId,
      category: BudgetCategory.ACTIVITIES,
      cents: activity.costCents,
      currency: activity.currency,
    });
  }
  for (const entry of transportCosts) {
    costs.push({
      dayId: entry.dayId,
      category: INTERCITY_TRANSPORT,
      cents: entry.amountCents,
      currency: entry.currency,
    });
  }

  const dayIds = new Set(days.map((day) => day.id));
  const counted = costs.filter((cost) => dayIds.has(cost.dayId));
  const currencies = [...new Set(counted.map((cost) => cost.currency))].sort(
    (a, b) =>
      a === PLATFORM_CURRENCY
        ? -1
        : b === PLATFORM_CURRENCY
          ? 1
          : a.localeCompare(b),
  );

  return {
    itineraryId,
    platformCurrency: PLATFORM_CURRENCY,
    totals: currencies.map((currency) => {
      const own = counted.filter((cost) => cost.currency === currency);
      const sum = (rows: typeof own) =>
        rows.reduce((total, row) => total + row.cents, 0);
      return {
        currency,
        totalCents: sum(own),
        byCategory: SUMMARY_CATEGORIES.map((category) => ({
          category,
          totalCents: sum(own.filter((cost) => cost.category === category)),
        })),
        byDay: days.map((day) => ({
          dayId: day.id,
          dayNumber: day.dayNumber,
          date: day.date,
          totalCents: sum(own.filter((cost) => cost.dayId === day.id)),
        })),
      };
    }),
  };
}

/** Day id -> total cents in the platform currency, for the budget subtotal of each city group (ITN-09). */
export function platformTotalsByDay(
  summary: BudgetSummaryDto,
): Map<string, number> {
  const platform = summary.totals.find(
    (total) => total.currency === summary.platformCurrency,
  );
  return new Map((platform?.byDay ?? []).map((d) => [d.dayId, d.totalCents]));
}
