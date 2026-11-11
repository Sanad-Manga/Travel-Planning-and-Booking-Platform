import { ApiProperty } from '@nestjs/swagger';
import { ItineraryDayDto } from './itinerary-day.dto';

/**
 * A run of consecutive days spent in the same city (ITN-09). Groups are never stored: they are derived from
 * the days on every read, so adding, deleting, editing or moving a day (ITN-05, ITN-07, ITN-08) and changing
 * the start date can never leave them out of date.
 */
export class CityGroupDto {
  @ApiProperty({
    example: 'cairo',
    description: 'Official city_id of every day in the group',
  })
  cityId: string;

  @ApiProperty({ example: 1, description: 'Day number of the first day' })
  fromDayNumber: number;

  @ApiProperty({ example: 2, description: 'Day number of the last day' })
  toDayNumber: number;

  @ApiProperty({ example: 2, description: 'How many days are in the group' })
  dayCount: number;

  @ApiProperty({
    example: '2026-12-20',
    description:
      'YYYY-MM-DD, the date of the first day. Hotel search for this city uses startDate and endDate (ITN-25).',
  })
  startDate: string;

  @ApiProperty({
    example: '2026-12-21',
    description: 'YYYY-MM-DD, the date of the last day',
  })
  endDate: string;

  @ApiProperty({
    example: 0,
    description:
      'Budget subtotal of the group in cents. It is 0 until the budget (ITN-14) adds up the activity and transport costs of the group days.',
  })
  subtotalCents: number;
}

/**
 * Groups the days of an itinerary: consecutive days in the same city share a group, so A, B, A is three
 * groups. `days` must already be in order (their position gives the day number, as ITN-05 does).
 */
export function groupDaysByCity(days: ItineraryDayDto[]): CityGroupDto[] {
  const groups: CityGroupDto[] = [];
  for (const day of days) {
    const last = groups[groups.length - 1];
    if (last && last.cityId === day.cityId) {
      last.toDayNumber = day.dayNumber;
      last.dayCount += 1;
      last.endDate = day.date;
    } else {
      groups.push({
        cityId: day.cityId,
        fromDayNumber: day.dayNumber,
        toDayNumber: day.dayNumber,
        dayCount: 1,
        startDate: day.date,
        endDate: day.date,
        subtotalCents: 0,
      });
    }
  }
  return groups;
}
