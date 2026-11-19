import { ApiProperty } from '@nestjs/swagger';
import { RefundStatus } from '../../common';
import { RefundSummary } from '../../refunds';
import { groupOf, HotelBookingGroup } from '../hotel-booking-groups';
import { HotelBookingLean } from '../schemas/hotel-booking.schema';
import { HotelBookingResponseDto } from './hotel-booking-response.dto';
import {
  HotelBookingGuestsDto,
  guestsOf,
  HotelOfBooking,
  MISSING_HOTEL_NAME,
} from './hotel-booking-summary.dto';

export class HotelBookingHotelDetailsDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({
    example: 'Nile Palace',
    description: `"${MISSING_HOTEL_NAME}" if the hotel record is missing.`,
  })
  name: string;

  @ApiProperty({ example: '1 Corniche Street', nullable: true, type: String })
  address: string | null;

  @ApiProperty({ example: 'CAI', nullable: true, type: String })
  cityId: string | null;

  @ApiProperty({
    example: '15:00',
    nullable: true,
    type: String,
    description: 'Local check-in time of the hotel (HTL-09), if it set one.',
  })
  checkInTime: string | null;

  @ApiProperty({
    example: '11:00',
    nullable: true,
    type: String,
    description: 'Local check-out time of the hotel (HTL-09), if it set one.',
  })
  checkOutTime: string | null;
}

export class HotelBookingRefundDto {
  @ApiProperty({ enum: RefundStatus, example: RefundStatus.PENDING })
  status: RefundStatus;

  @ApiProperty({
    example: 12750,
    description: 'Amount refunded or being refunded, in cents.',
  })
  amountCents: number;
}

/**
 * `GET /api/hotel-bookings/:id`: the HTL-17 reservation (every field, type and status code unchanged) plus what HTL-20 adds on top:
 * the hotel, the guests, the group (Upcoming / Past / Cancelled), the refund of a cancelled reservation and the creation time.
 */
export class HotelBookingDetailsDto extends HotelBookingResponseDto {
  @ApiProperty({
    type: HotelBookingHotelDetailsDto,
    description:
      'HTL-20: the hotel of the reservation (hidden hotels included: a stay outlives its listing).',
  })
  hotel: HotelBookingHotelDetailsDto;

  @ApiProperty({
    type: HotelBookingGuestsDto,
    description: 'HTL-20: adults and children over all rooms.',
  })
  guests: HotelBookingGuestsDto;

  @ApiProperty({
    enum: HotelBookingGroup,
    example: HotelBookingGroup.UPCOMING,
    description: 'HTL-20: the group of the reservation in "My reservations".',
  })
  group: HotelBookingGroup;

  @ApiProperty({
    type: HotelBookingRefundDto,
    nullable: true,
    description:
      'HTL-20: the refund of a cancelled reservation (PAY-03, read through RefundsService.getLatestForBooking). ' +
      'null while no refund is recorded.',
  })
  refund: HotelBookingRefundDto | null;

  @ApiProperty({
    example: '2026-11-15T18:00:00.000Z',
    description: 'HTL-20: when the reservation was created.',
  })
  createdAt: string;

  /** `refund` is what PAY-03 recorded for this reservation (RefundsService.getLatestForBooking), or null. */
  static of(
    booking: HotelBookingLean,
    hotel: HotelOfBooking,
    refund: RefundSummary | null,
    now: Date,
  ): HotelBookingDetailsDto {
    return {
      ...HotelBookingResponseDto.from(booking),
      hotel: {
        id: booking.hotelId.toString(),
        name: hotel?.name ?? MISSING_HOTEL_NAME,
        address: hotel?.address ?? null,
        cityId: hotel?.cityId ?? null,
        checkInTime: hotel?.checkInTime ?? null,
        checkOutTime: hotel?.checkOutTime ?? null,
      },
      guests: guestsOf(booking),
      group: groupOf(booking, now),
      refund: refund
        ? { status: refund.status, amountCents: refund.amountCents }
        : null,
      createdAt: booking.createdAt.toISOString(),
    };
  }
}
