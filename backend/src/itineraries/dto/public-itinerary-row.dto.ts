import { ApiProperty } from '@nestjs/swagger';
import { ItineraryLean } from '../schemas/itinerary.schema';

/**
 * One row of GET /api/itineraries/public/search (ITN-20). Only public, visible itineraries are listed, so
 * visibility and the hidden flag are not repeated. ITN-21 adds keyword and duration filters and the full
 * read-only view.
 */
export class PublicItineraryRowDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d0f',
    description: 'The author (a user id)',
  })
  authorId: string;

  @ApiProperty({ example: 'Two weeks in Egypt and the UAE' })
  title: string;

  @ApiProperty({ example: ['EG', 'AE'], type: [String] })
  countryCodes: string[];

  @ApiProperty({ example: '2026-12-20', description: 'YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({
    example: '2026-11-04T10:00:00.000Z',
    description: 'The list is ordered by this, newest first',
  })
  updatedAt: string;
}

export function toPublicItineraryRow(
  doc: ItineraryLean,
): PublicItineraryRowDto {
  return {
    id: doc._id.toString(),
    authorId: doc.authorId.toString(),
    title: doc.title,
    countryCodes: doc.countryCodes,
    startDate: doc.startDate,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
