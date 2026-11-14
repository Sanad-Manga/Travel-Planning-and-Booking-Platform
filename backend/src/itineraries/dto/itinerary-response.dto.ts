import { ApiProperty } from '@nestjs/swagger';
import { Visibility } from '../../common';
import { ItineraryLean } from '../schemas/itinerary.schema';
import { ActivityDto } from './activity.dto';
import { BudgetDto } from './budget.dto';
import { buildBudgetSummary, platformTotalsByDay } from './budget-summary.dto';
import { CityGroupDto, groupDaysByCity } from './city-group.dto';
import { ClonedFromDto, toClonedFrom } from './cloned-from.dto';
import { ItineraryDayDto, toItineraryDay } from './itinerary-day.dto';
import { TransportCostDto } from './transport-cost.dto';

export class ItineraryResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d0f',
    description: 'The owner (a user id)',
  })
  authorId: string;

  @ApiProperty({ example: 'Two weeks in Egypt and the UAE' })
  title: string;

  @ApiProperty({ example: ['EG', 'AE'], type: [String] })
  countryCodes: string[];

  @ApiProperty({ example: '2026-12-20', description: 'YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({ enum: Visibility, example: Visibility.PRIVATE })
  visibility: Visibility;

  @ApiProperty({
    example: false,
    description: 'true when an admin hid it; only its author and admins see it',
  })
  isHidden: boolean;

  @ApiProperty({
    type: [ItineraryDayDto],
    description: 'The days in order (ITN-05), numbered from 1',
  })
  days: ItineraryDayDto[];

  @ApiProperty({
    type: [CityGroupDto],
    description:
      'Consecutive days in the same city, grouped (ITN-09): A, B, A is three groups. Each has its day count, start and end date and budget subtotal.',
  })
  cityGroups: CityGroupDto[];

  @ApiProperty({
    type: [TransportCostDto],
    description:
      'The intercity transport costs (ITN-16), oldest first. Each belongs to one day (dayId).',
  })
  transportCosts: TransportCostDto[];

  @ApiProperty({
    type: [BudgetDto],
    description:
      'The daily budget entries (ITN-14), oldest first. Each belongs to one day (dayId). The totals are in GET /api/itineraries/:id/budget-summary.',
  })
  budgets: BudgetDto[];

  @ApiProperty({
    type: ClonedFromDto,
    nullable: true,
    description:
      'Set when this itinerary is a copy of a public one (ITN-21): the itinerary it came from and its author. null otherwise.',
  })
  clonedFrom: ClonedFromDto | null;

  @ApiProperty({ example: '2026-11-04T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-04T10:00:00.000Z' })
  updatedAt: string;
}

/** Response DTO, never the raw document: `_id` becomes `id`, ids are strings and `__v` is not exposed. */
export function toItineraryResponse(
  doc: ItineraryLean,
  activities: ActivityDto[] = [],
  transportCosts: TransportCostDto[] = [],
  budgets: BudgetDto[] = [],
): ItineraryResponseDto {
  const days = (doc.days ?? []).map((day, index) =>
    toItineraryDay(day, index, doc.startDate, activities),
  );
  return {
    id: doc._id.toString(),
    authorId: doc.authorId.toString(),
    title: doc.title,
    countryCodes: doc.countryCodes,
    startDate: doc.startDate,
    visibility: doc.visibility,
    isHidden: doc.isHidden,
    days,
    cityGroups: groupDaysByCity(
      days,
      platformTotalsByDay(
        buildBudgetSummary(
          doc._id.toString(),
          days,
          activities,
          transportCosts,
          budgets,
        ),
      ),
    ),
    transportCosts,
    budgets,
    clonedFrom: toClonedFrom(doc.clonedFrom),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
