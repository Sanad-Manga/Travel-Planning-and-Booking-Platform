import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

/**
 * Body of `PATCH /api/flight-bookings/:id/change-flight` (FLT-27). The cabin, route and airline are
 * not client inputs: the replacement must keep the booking's existing cabin and route, and the
 * lead-approved slice only allows another flight of the same airline.
 */
export class ChangeFlightBookingDto {
  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d0e',
    description:
      'The replacement flight. It must be a different SCHEDULED flight on the booking outbound route, in the same cabin and on the same airline.',
  })
  @IsMongoId()
  flightId: string;
}
