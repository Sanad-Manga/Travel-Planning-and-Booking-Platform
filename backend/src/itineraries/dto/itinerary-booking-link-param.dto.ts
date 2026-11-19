import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { ItineraryIdParamDto } from './itinerary-id-param.dto';

export class ItineraryBookingLinkParamDto extends ItineraryIdParamDto {
  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d50',
    description:
      'The id of the link (the `id` of POST /api/itineraries/:id/bookings), not the booking id',
  })
  @IsMongoId({ message: 'linkId must be a valid id' })
  linkId: string;
}
