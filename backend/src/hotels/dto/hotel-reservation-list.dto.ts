import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus, PaginatedResponse } from '../../common';

/** The traveler who made the reservation, as the hotel moderator may see them (HTL-22). */
export class HotelReservationGuestDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182920' })
  userId: string;

  @ApiProperty({ example: 'Mona Adel', description: 'Display name of the account that made the reservation.' })
  name: string;
}

/** One reservation row in a hotel moderator's list (HTL-22). Read-only. */
export class HotelReservationRowDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  id: string;

  @ApiProperty({
    example: 'HTL-1A2B3C4D5E6F7788',
    nullable: true,
    description: 'Guest-facing reference, assigned when payment confirms the reservation; null for a pending hold.',
  })
  bookingReference: string | null;

  @ApiProperty({ type: HotelReservationGuestDto })
  guest: HotelReservationGuestDto;

  @ApiProperty({ example: '2027-03-10', description: 'Check-in day (YYYY-MM-DD).' })
  checkIn: string;

  @ApiProperty({ example: '2027-03-13', description: 'Check-out day (YYYY-MM-DD), the first day after the stay.' })
  checkOut: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  status: BookingStatus;
}

/** Standard pagination envelope for a hotel's reservations (HTL-22). */
export class HotelReservationsPageDto implements PaginatedResponse<HotelReservationRowDto> {
  @ApiProperty({ type: [HotelReservationRowDto] })
  items: HotelReservationRowDto[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 2 })
  totalPages: number;
}
