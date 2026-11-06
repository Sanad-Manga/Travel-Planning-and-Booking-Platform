import { PartialType } from '@nestjs/swagger';
import { CreateItineraryDayDto } from './create-itinerary-day.dto';

/**
 * Body of PATCH /api/itineraries/:id/days/:dayId (ITN-05): the day's city and/or notes.
 * At least one must be sent (checked in the service).
 */
export class UpdateItineraryDayDto extends PartialType(CreateItineraryDayDto) {}
