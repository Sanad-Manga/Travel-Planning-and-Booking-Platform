import { PartialType } from '@nestjs/swagger';
import { CreateItineraryDto } from './create-itinerary.dto';

/**
 * Body of PATCH /api/itineraries/:id: any of title, countryCodes, startDate (ITN-01).
 * At least one must be sent (checked in the service). Visibility is added by ITN-20.
 */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {}
