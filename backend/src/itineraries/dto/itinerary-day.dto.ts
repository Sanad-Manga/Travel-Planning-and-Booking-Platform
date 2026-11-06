import { ApiProperty } from '@nestjs/swagger';
import { ItineraryDayLean } from '../schemas/itinerary.schema';

export class ItineraryDayDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d10' })
  id: string;

  @ApiProperty({
    example: 1,
    description: 'Position in the itinerary, starting at 1. Always sequential.',
  })
  dayNumber: number;

  @ApiProperty({
    example: '2026-12-20',
    description: 'YYYY-MM-DD: the itinerary start date + (dayNumber - 1) days',
  })
  date: string;

  @ApiProperty({
    example: 'cairo',
    description: 'Official city_id from the seeded city list',
  })
  cityId: string;

  @ApiProperty({ example: 'Pyramids of Giza in the morning' })
  notes: string;
}

/** `startDate` (YYYY-MM-DD) + `offset` days, as YYYY-MM-DD. Calculated in UTC, so no time zone can shift it. */
export function addDays(startDate: string, offset: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** The day at `index` (0-based) of an itinerary starting on `startDate`. */
export function toItineraryDay(
  day: ItineraryDayLean,
  index: number,
  startDate: string,
): ItineraryDayDto {
  return {
    id: day._id.toString(),
    dayNumber: index + 1,
    date: addDays(startDate, index),
    cityId: day.cityId,
    notes: day.notes ?? '',
  };
}
