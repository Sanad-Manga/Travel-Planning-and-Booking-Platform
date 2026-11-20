import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BookingStatus,
  BookingType,
  CabinClass,
  RefundStatus,
} from '../../common';
import {
  BookingPassengerResponseDto,
  FlightBookingSegmentResponseDto,
  PassengerCountsDto,
} from './flight-booking-response.dto';
import { FlightResponseDto } from './flight-response.dto';
import { SeatSelectionDto } from './select-seat.dto';

export class FlightBookingSummarySegmentDto extends FlightBookingSegmentResponseDto {
  @ApiProperty({ type: FlightResponseDto })
  flight: FlightResponseDto;
}

/** The latest refund as published by PAY-03's `RefundSummary`; Stripe ids and the user id stay internal. */
export class FlightBookingRefundDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d05' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  bookingType: BookingType;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' })
  bookingId: string;

  @ApiProperty({ enum: RefundStatus, example: RefundStatus.REFUNDED })
  status: RefundStatus;

  @ApiProperty({ example: 12500, description: 'Integer minor units (cents)' })
  amountCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiPropertyOptional({ example: 'Cancelled per tier 2' })
  reason?: string;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  createdAt: Date;
}

export class FlightBookingSummaryResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' })
  id: string;

  @ApiProperty({ type: FlightResponseDto })
  flight: FlightResponseDto;

  @ApiProperty({
    type: [FlightBookingSummarySegmentDto],
    description: 'Outbound then return; a one-way booking has one segment',
  })
  segments: FlightBookingSummarySegmentDto[];

  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  cabinClass: CabinClass;

  @ApiProperty({ type: PassengerCountsDto })
  passengerCounts: PassengerCountsDto;

  @ApiProperty({
    type: [BookingPassengerResponseDto],
    description:
      'Passenger names, dates of birth, types and baggage; empty for legacy bookings created before FLT-19',
  })
  passengers: BookingPassengerResponseDto[];

  @ApiProperty({
    example: 3000,
    description: 'Total extra-baggage fees in integer cents',
  })
  baggageFeeCents: number;

  @ApiProperty({
    example: 139500,
    description: 'Payable booking amount in integer cents',
  })
  totalCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.PENDING_PAYMENT })
  status: BookingStatus;

  @ApiProperty({
    example: '2026-11-07T12:10:00.000Z',
    nullable: true,
    description:
      'UTC hold expiry time while the booking waits for payment; null once it is confirmed',
  })
  holdExpiresAt: string | null;

  @ApiPropertyOptional({
    example: 'FLT-9F2C41A7B3D84E60',
    description:
      'Unique booking reference, present once the booking is confirmed. Absent while pending payment and for historical confirmed bookings created before FLT-23.',
  })
  bookingReference?: string;

  @ApiPropertyOptional({
    type: [SeatSelectionDto],
    description:
      'Seats the traveler chose (FLT-28), at most one per passenger per flight. Absent until a seat is chosen.',
  })
  seatSelections?: SeatSelectionDto[];

  @ApiPropertyOptional({
    type: FlightBookingRefundDto,
    nullable: true,
    description:
      'Latest refund for this booking, read through RefundsService.getLatestForBooking; null when no refund was issued. Present only on a confirmed booking.',
  })
  refund?: FlightBookingRefundDto | null;
}
