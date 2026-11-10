import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, Max, Min } from 'class-validator';
import { ITINERARY_MAX_DAYS } from '../../common';

/**
 * Body of PATCH /api/itineraries/:id/days/reorder (ITN-08): move one day to a new position.
 * Whether the position fits this itinerary (not after its last day) is checked in the service.
 */
export class ReorderDaysDto {
  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d10',
    description: 'The day to move',
  })
  @IsMongoId({ message: 'dayId must be a valid id' })
  dayId: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: ITINERARY_MAX_DAYS,
    description:
      'The new day number (1 = first day). It must not be after the last day of the itinerary.',
  })
  @IsInt({ message: 'position must be a whole number' })
  @Min(1, { message: 'position must be at least 1' })
  @Max(ITINERARY_MAX_DAYS, {
    message: `position must be at most ${ITINERARY_MAX_DAYS}`,
  })
  position: number;
}
