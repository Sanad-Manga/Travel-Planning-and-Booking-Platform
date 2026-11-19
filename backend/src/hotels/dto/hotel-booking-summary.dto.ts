import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common';
import { groupOf, HotelBookingGroup } from '../hotel-booking-groups';
import { HotelBookingLean } from '../schemas/hotel-booking.schema';
import { Hotel } from '../schemas/hotel.schema';

/** What a reservation needs from its hotel record. A reservation outlives a hotel record that is missing or hidden. */
export type HotelOfBooking =
  | Pick<Hotel, 'name' | 'address' | 'cityId' | 'checkInTime' | 'checkOutTime'>
  | undefined;

/** Shown when the hotel record is gone, so one broken row cannot break the whole list. */
export const MISSING_HOTEL_NAME = 'Hotel no longer listed';

export class HotelBookingHotelDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({
    example: 'Nile Palace',
    description: `"${MISSING_HOTEL_NAME}" if the hotel record is missing.`,
  })
  name: string;

  @ApiProperty({ example: 'CAI', nullable: true, type: String })
  cityId: string | null;
}

export class HotelBookingRoomSummaryDto {
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
}

export class HotelBookingGuestsDto {
  @ApiProperty({ example: 3, description: 'Adults in all rooms together.' })
  adults: number;

  @ApiProperty({ example: 1, description: 'Children in all rooms together.' })
  children: number;
}

/** One row of `GET /api/hotel-bookings` (HTL-20). Payment data (`paymentRef`) is never part of it. */
export class HotelBookingSummaryDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  id: string;

  @ApiPropertyOptional({
    example: 'HTL-9F2A41C07B3D5E68',
    description: 'Given when payment confirms the reservation; absent before.',
  })
  bookingReference?: string;

  @ApiProperty({ type: HotelBookingHotelDto })
  hotel: HotelBookingHotelDto;

  @ApiProperty({ example: '2027-03-10' })
  checkIn: string;

  @ApiProperty({ example: '2027-03-13' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({ type: [HotelBookingRoomSummaryDto] })
  rooms: HotelBookingRoomSummaryDto[];

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

  static from(
    booking: HotelBookingLean,
    hotel: HotelOfBooking,
    now: Date,
  ): HotelBookingSummaryDto {
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference,
      hotel: hotelOf(booking, hotel),
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights: booking.nights,
      rooms: booking.rooms.map((room) => ({
        roomId: room.roomId.toString(),
        name: room.name,
        type: room.type,
        adults: room.adults,
        children: room.children,
      })),
      guests: guestsOf(booking),
      totalCents: booking.totalCents,
      currency: booking.currency,
      status: booking.status,
      group: groupOf(booking, now),
      holdExpiresAt: booking.holdExpiresAt?.toISOString(),
    };
  }
}

export function hotelOf(
  booking: Pick<HotelBookingLean, 'hotelId'>,
  hotel: HotelOfBooking,
): HotelBookingHotelDto {
  return {
    id: booking.hotelId.toString(),
    name: hotel?.name ?? MISSING_HOTEL_NAME,
    cityId: hotel?.cityId ?? null,
  };
}

export function guestsOf(
  booking: Pick<HotelBookingLean, 'rooms'>,
): HotelBookingGuestsDto {
  return {
    adults: booking.rooms.reduce((sum, room) => sum + room.adults, 0),
    children: booking.rooms.reduce((sum, room) => sum + room.children, 0),
  };
}
