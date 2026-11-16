import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, RefundStatus } from '../../common';
import { groupOf, HotelBookingGroup } from '../hotel-booking-groups';
import { HotelBookingLean } from '../schemas/hotel-booking.schema';
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

export class HotelBookingRoomDetailsDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182940' })
  roomId: string;

  @ApiProperty({ example: '101' })
  name: string;

  @ApiProperty({ example: 'Double' })
  type: string;

  @ApiProperty({ example: 2 })
  adults: number;

  @ApiProperty({ example: 1 })
  children: number;

  @ApiProperty({ example: 3 })
  maxOccupancy: number;

  @ApiProperty({
    example: 8500,
    description:
      'Price per night captured when the reservation was created, in cents.',
  })
  pricePerNightCents: number;

  @ApiProperty({
    example: 25500,
    description:
      'This room price multiplied by the number of nights, in cents.',
  })
  totalCents: number;
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

/** `GET /api/hotel-bookings/:id` (HTL-20): one reservation of the logged-in traveler, with everything they paid for. */
export class HotelBookingDetailsDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  id: string;

  @ApiPropertyOptional({
    example: 'HTL-9F2A41C07B3D5E68',
    description: 'Given when payment confirms the reservation; absent before.',
  })
  bookingReference?: string;

  @ApiProperty({ type: HotelBookingHotelDetailsDto })
  hotel: HotelBookingHotelDetailsDto;

  @ApiProperty({ example: '2027-03-10' })
  checkIn: string;

  @ApiProperty({ example: '2027-03-13' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({
    type: [HotelBookingRoomDetailsDto],
    description:
      'The price of each room is the one captured when the reservation was created.',
  })
  rooms: HotelBookingRoomDetailsDto[];

  @ApiProperty({ type: HotelBookingGuestsDto })
  guests: HotelBookingGuestsDto;

  @ApiProperty({
    example: 25500,
    description: 'Total of the reservation, in cents.',
  })
  totalCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  status: BookingStatus;

  @ApiProperty({ enum: HotelBookingGroup, example: HotelBookingGroup.UPCOMING })
  group: HotelBookingGroup;

  @ApiPropertyOptional({
    example: '2026-11-15T18:10:00.000Z',
    description: 'Only while the reservation waits for payment.',
  })
  holdExpiresAt?: string;

  @ApiProperty({
    type: HotelBookingRefundDto,
    nullable: true,
    description:
      'Refund of a cancelled reservation (PAY-03). null while no refund is recorded. ' +
      'Payments (PAY-03) owns refunds: this field is filled from there once that module exists on this branch.',
  })
  refund: HotelBookingRefundDto | null;

  @ApiProperty({ example: '2026-11-15T18:00:00.000Z' })
  createdAt: string;

  static from(
    booking: HotelBookingLean,
    hotel: HotelOfBooking,
    now: Date,
  ): HotelBookingDetailsDto {
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference,
      hotel: {
        id: booking.hotelId.toString(),
        name: hotel?.name ?? MISSING_HOTEL_NAME,
        address: hotel?.address ?? null,
        cityId: hotel?.cityId ?? null,
        checkInTime: hotel?.checkInTime ?? null,
        checkOutTime: hotel?.checkOutTime ?? null,
      },
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights: booking.nights,
      rooms: booking.rooms.map((room) => ({
        roomId: room.roomId.toString(),
        name: room.name,
        type: room.type,
        adults: room.adults,
        children: room.children,
        maxOccupancy: room.maxOccupancy,
        pricePerNightCents: room.pricePerNightCents,
        totalCents: room.totalCents,
      })),
      guests: guestsOf(booking),
      totalCents: booking.totalCents,
      currency: booking.currency,
      status: booking.status,
      group: groupOf(booking, now),
      holdExpiresAt: booking.holdExpiresAt?.toISOString(),
      // PAY-03 has no refund record to read yet. Until it exists this is always null, never a guess.
      refund: null,
      createdAt: booking.createdAt.toISOString(),
    };
  }
}
