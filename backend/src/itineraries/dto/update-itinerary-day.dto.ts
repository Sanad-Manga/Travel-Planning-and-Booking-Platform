import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CITY_ID_DESCRIPTION,
  CityIdRules,
  IfSent,
  ITINERARY_DAY_NOTES_MAX_LENGTH,
  NOTES_EXAMPLE,
  NotesRules,
} from './create-itinerary-day.dto';

/**
 * Body of PATCH /api/itineraries/:id/days/:dayId (ITN-05): the day's city and/or notes.
 * At least one must be sent (checked in the service). Written out instead of PartialType, because
 * PartialType's @IsOptional() would let `null` through unvalidated.
 */
export class UpdateItineraryDayDto {
  @ApiPropertyOptional({ example: 'dubai', description: CITY_ID_DESCRIPTION })
  @IfSent()
  @CityIdRules()
  cityId?: string;

  @ApiPropertyOptional({
    example: NOTES_EXAMPLE,
    maxLength: ITINERARY_DAY_NOTES_MAX_LENGTH,
    description: 'Free text. Send an empty string to clear it.',
  })
  @NotesRules()
  notes?: string;
}
