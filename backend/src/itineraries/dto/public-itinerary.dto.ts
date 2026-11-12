import { ApiProperty } from '@nestjs/swagger';
import { ItineraryLean } from '../schemas/itinerary.schema';
import { ActivityDto } from './activity.dto';
import { ItineraryDayDto, toItineraryDay } from './itinerary-day.dto';

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

  @ApiProperty({ example: '2026-11-04T10:00:00.000Z' })
  updatedAt: string;
}

export function toPublicItinerary(
  doc: ItineraryLean,
  author: { id: string; name: string },
  activities: ActivityDto[],
): PublicItineraryDto {
  return {
    id: doc._id.toString(),
    title: doc.title,
    countryCodes: doc.countryCodes,
    startDate: doc.startDate,
    author: { id: author.id, name: author.name },
    days: (doc.days ?? []).map((day, index): ItineraryDayDto =>
      toItineraryDay(day, index, doc.startDate, activities),
    ),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
