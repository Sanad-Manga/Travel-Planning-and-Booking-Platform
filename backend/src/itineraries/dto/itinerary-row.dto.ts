import { ApiProperty } from '@nestjs/swagger';
import { Visibility } from '../../common';
import { ItineraryLean } from '../schemas/itinerary.schema';

/** One row of GET /api/itineraries (ITN-03): what the "my itineraries" list shows. */
export class ItineraryRowDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiProperty({ example: 'Two weeks in Egypt and the UAE' })
  title: string;

  @ApiProperty({ example: ['EG', 'AE'], type: [String] })
  countryCodes: string[];

  @ApiProperty({ example: '2026-12-20', description: 'YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({
    example: 5,
    description: 'Number of days in the itinerary (ITN-05), at most 60',
  })
  dayCount: number;

  @ApiProperty({ enum: Visibility, example: Visibility.PRIVATE })
  visibility: Visibility;

  @ApiProperty({
    example: false,
    description: 'true when an admin hid it; its author still sees it here',
  })
  isHidden: boolean;

  @ApiProperty({
    example: '2026-11-04T10:00:00.000Z',
    description: 'The list is ordered by this, newest first',
  })
  updatedAt: string;
}

/**
 * The fields a list row needs. Only the day ids are read, to count the days: the days' cities and notes
 * (up to 60 x 2000 characters per itinerary) are never loaded for the list.
 */
export const ITINERARY_ROW_PROJECTION =
  'title countryCodes startDate visibility isHidden updatedAt days._id';

/** Maps a lean document from paginate() to a list row. */
export function toItineraryRow(doc: ItineraryLean): ItineraryRowDto {
  return {
    id: doc._id.toString(),
    title: doc.title,
    countryCodes: doc.countryCodes,
    startDate: doc.startDate,
    dayCount: doc.days?.length ?? 0,
    visibility: doc.visibility,
    isHidden: doc.isHidden,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
