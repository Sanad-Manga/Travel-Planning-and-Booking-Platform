import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CabinClass, PaginationDto, PassengerType } from '../../common';

/** The statuses a moderator can list: bookings that reached payment (unpaid holds and expired holds are not passengers). */
export enum RosterBookingStatus {
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

/** FLT-29: `GET /api/flights/:id/bookings?page=1&limit=10&status=CONFIRMED`. */
export class FlightRosterQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: RosterBookingStatus,
    description:
      'Return only bookings with this status. Omit it to list CONFIRMED, CANCELLED and COMPLETED bookings.',
  })
  @IsOptional()
  @IsEnum(RosterBookingStatus, {
    message: 'status must be CONFIRMED, CANCELLED or COMPLETED',
  })
  status?: RosterBookingStatus;
}

export class FlightRosterPassengerDto {
  @ApiProperty({ example: 'Sara Hassan' })
  fullName: string;

  @ApiProperty({ enum: PassengerType, example: PassengerType.ADULT })
  passengerType: PassengerType;
}

export class FlightRosterBookingDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiPropertyOptional({
    example: 'FLT-AB12CD34EF56',
    description:
      'Absent on historical bookings confirmed before booking references existed',
  })
  bookingReference?: string;

  @ApiProperty({ enum: RosterBookingStatus, example: 'CONFIRMED' })
  status: string;

  @ApiProperty({
    enum: CabinClass,
    description: 'The cabin booked on THIS flight',
  })
  cabinClass: CabinClass;

  @ApiProperty({
    example: 2,
    description: 'Seats this booking takes on THIS flight (infants take none)',
  })
  seats: number;

  @ApiProperty({
    type: [FlightRosterPassengerDto],
    description:
      'Passenger names; empty on legacy bookings made before passenger details were collected. Passport and ID numbers are never returned.',
  })
  passengers: FlightRosterPassengerDto[];

  @ApiProperty({
    example: 26,
    description:
      'Seats still free in this cabin of the flight right now (total - booked - held, never below 0). The same for every row of that cabin.',
  })
  cabinSeatsRemaining: number;
}
