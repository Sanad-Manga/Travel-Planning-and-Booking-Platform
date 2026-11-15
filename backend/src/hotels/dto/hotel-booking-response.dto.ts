import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../../common';
import { HotelBookingDocument, HotelBookingLean } from '../schemas/hotel-booking.schema';

export class HotelBookingRoomResponseDto {
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

  @ApiProperty({ example: 8500, description: 'Price per night captured when the reservation was created, in cents.' })
  pricePerNightCents: number;

  @ApiProperty({ example: 25500, description: 'This room price multiplied by the number of nights, in cents.' })
  totalCents: number;
}

export class HotelBookingResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  id: string;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  hotelId: string;

  @ApiProperty({ example: '2027-03-10' })
  checkIn: string;

  @ApiProperty({ example: '2027-03-13' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({ type: [HotelBookingRoomResponseDto] })
  rooms: HotelBookingRoomResponseDto[];

  @ApiProperty({ example: 25500, description: 'Sum of each room stay total, in cents.' })
  totalCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.PENDING_PAYMENT })
  status: BookingStatus;

  @ApiProperty({ example: '2026-11-15T18:10:00.000Z' })
  holdExpiresAt: string;

  static from(booking: HotelBookingDocument | HotelBookingLean): HotelBookingResponseDto {
    return {
      id: booking._id.toString(),
      hotelId: booking.hotelId.toString(),
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
      totalCents: booking.totalCents,
      currency: booking.currency,
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt!.toISOString(),
    };
  }
}
