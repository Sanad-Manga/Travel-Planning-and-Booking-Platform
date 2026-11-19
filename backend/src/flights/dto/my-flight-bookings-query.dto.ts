import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common';

/**
 * FLT-25: the three groups of "my flight bookings". This is a flights-module concept, not a shared
 * enum: `common/` is frozen and every other module keeps its own list vocabulary.
 * - `CANCELLED`: the booking status is CANCELLED, whatever the departure date.
 * - `UPCOMING`: any other status whose outbound segment departs after the current UTC time.
 * - `PAST`: any other status whose outbound segment departed at or before the current UTC time.
 */
export enum FlightBookingGroup {
  UPCOMING = 'UPCOMING',
  PAST = 'PAST',
  CANCELLED = 'CANCELLED',
}

/** FLT-25: `GET /api/flight-bookings?page=1&limit=10&group=UPCOMING`. */
export class MyFlightBookingsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: FlightBookingGroup,
    description:
      'Return only this group. Cancellation takes precedence over the departure date; a round trip is grouped by its outbound segment. Omit it to receive every group in one paginated list.',
  })
  @IsOptional()
  @IsEnum(FlightBookingGroup)
  group?: FlightBookingGroup;
}
