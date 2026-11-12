import { ApiProperty } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../common';
import { ActivityLean } from '../schemas/activity.schema';

export class ActivityImageDto {
  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d50',
    description: 'The image id; use it to remove the image',
  })
  id: string;

  @ApiProperty({
    example: '/uploads/674a1b2c3d4e5f6a7b8c9d50.png',
    description:
      'Public path of the file on the backend origin (without /api), as the upload service returned it',
  })
  url: string;
}

export class ActivityDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d20' })
  id: string;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  itineraryId: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d10',
    description: 'The day (of this itinerary) the activity is planned for',
  })
  dayId: string;

  @ApiProperty({ example: 'Pyramids of Giza' })
  name: string;

  @ApiProperty({
    example: 'Early morning, before the crowds',
    description: 'Empty when not set',
  })
  description: string;

  @ApiProperty({
    example: '08:30',
    nullable: true,
    type: String,
    description: 'Start time HH:mm (24 hours), or null when not set',
  })
  time: string | null;

  @ApiProperty({
    example: 3500,
    nullable: true,
    type: Number,
    description:
      'Cost in integer cents of the platform currency, or null when not set. 0 is free. Counted under "Activities" in the budget (ITN-14).',
  })
  costCents: number | null;

  @ApiProperty({ example: PLATFORM_CURRENCY })
  currency: string;

  @ApiProperty({
    type: [ActivityImageDto],
    description:
      'The images attached to the activity (ITN-12), at most 5, in the order they were attached',
  })
  images: ActivityImageDto[];
}

/** Response DTO, never the raw document: `_id` becomes `id`, ids are strings, missing time/cost become null. */
export function toActivityDto(doc: ActivityLean): ActivityDto {
  return {
    id: doc._id.toString(),
    itineraryId: doc.itineraryId.toString(),
    dayId: doc.dayId.toString(),
    name: doc.name,
    description: doc.description ?? '',
    time: doc.time ?? null,
    costCents: doc.costCents ?? null,
    currency: PLATFORM_CURRENCY,
    images: (doc.images ?? []).map(({ id, url }) => ({ id, url })),
  };
}
