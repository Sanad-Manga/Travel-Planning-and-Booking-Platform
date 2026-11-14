import { ApiProperty } from '@nestjs/swagger';
import { ItineraryLean } from '../schemas/itinerary.schema';
import { ActivityDto } from './activity.dto';
import { BudgetDto } from './budget.dto';
import { buildBudgetSummary, BudgetSummaryDto } from './budget-summary.dto';
import { ClonedFromDto, toClonedFrom } from './cloned-from.dto';
import { ItineraryDayDto, toItineraryDay } from './itinerary-day.dto';
import { TransportCostDto } from './transport-cost.dto';

export class PublicAuthorDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' })
  id: string;

  @ApiProperty({ example: 'Alice Author' })
  name: string;
}

/**
 * The read-only view of a public itinerary (ITN-21): what a reader needs and nothing an edit screen would use. It
 * has no visibility or hidden flag (only visible public itineraries get here) and no owner field besides the author.
 */
export class PublicItineraryDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiProperty({ example: 'Two weeks in Egypt and the UAE' })
  title: string;

  @ApiProperty({ example: ['EG', 'AE'], type: [String] })
  countryCodes: string[];

  @ApiProperty({ example: '2026-12-20', description: 'YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({ type: PublicAuthorDto })
  author: PublicAuthorDto;

  @ApiProperty({
    type: [ItineraryDayDto],
    description: 'The days in order, numbered from 1, each with its activities',
  })
  days: ItineraryDayDto[];

  @ApiProperty({
    type: BudgetSummaryDto,
    description:
      'What the trip costs: the totals by currency, by category and by day, like GET /api/itineraries/:id/budget-summary. Amounts in different currencies are not added together.',
  })
  budget: BudgetSummaryDto;

  @ApiProperty({
    type: ClonedFromDto,
    nullable: true,
    description:
      'Set when this itinerary is a copy of another public one (ITN-21): who made the original. null otherwise.',
  })
  clonedFrom: ClonedFromDto | null;

  @ApiProperty({ example: '2026-11-04T10:00:00.000Z' })
  updatedAt: string;
}

export function toPublicItinerary(
  doc: ItineraryLean,
  author: { id: string; name: string },
  activities: ActivityDto[],
  transportCosts: TransportCostDto[],
  budgets: BudgetDto[],
): PublicItineraryDto {
  const days = (doc.days ?? []).map((day, index) =>
    toItineraryDay(day, index, doc.startDate, activities),
  );
  return {
    id: doc._id.toString(),
    title: doc.title,
    countryCodes: doc.countryCodes,
    startDate: doc.startDate,
    author: { id: author.id, name: author.name },
    days,
    budget: buildBudgetSummary(
      doc._id.toString(),
      days,
      activities,
      transportCosts,
      budgets,
    ),
    clonedFrom: toClonedFrom(doc.clonedFrom),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
