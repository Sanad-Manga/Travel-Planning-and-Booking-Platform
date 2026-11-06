import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Visibility } from '../../common';
import { CreateItineraryDto } from './create-itinerary.dto';

/**
 * Body of PATCH /api/itineraries/:id: any of title, countryCodes, startDate (ITN-01) and visibility (ITN-20).
 * At least one must be sent (checked in the service).
 */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {
  @ApiPropertyOptional({
    enum: Visibility,
    example: Visibility.PUBLIC,
    description:
      'PUBLIC: other users can read it (read-only). PRIVATE: only the owner sees it, from the next request on.',
  })
  @IsOptional()
  @IsEnum(Visibility, {
    message: `visibility must be one of: ${Object.values(Visibility).join(', ')}`,
  })
  visibility?: Visibility;
}
