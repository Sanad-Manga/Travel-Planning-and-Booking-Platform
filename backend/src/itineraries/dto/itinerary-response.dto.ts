import { ApiProperty } from '@nestjs/swagger';
import { Visibility } from '../../common';
import { ItineraryLean } from '../schemas/itinerary.schema';
import { CityGroupDto, groupDaysByCity } from './city-group.dto';
import { ItineraryDayDto, toItineraryDay } from './itinerary-day.dto';

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

  @ApiProperty({ example: '2026-11-04T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-04T10:00:00.000Z' })
  updatedAt: string;
}

/** Response DTO, never the raw document: `_id` becomes `id`, ids are strings and `__v` is not exposed. */
export function toItineraryResponse(doc: ItineraryLean): ItineraryResponseDto {
  const days = (doc.days ?? []).map((day, index) =>
    toItineraryDay(day, index, doc.startDate),
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
    cityGroups: groupDaysByCity(days),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
