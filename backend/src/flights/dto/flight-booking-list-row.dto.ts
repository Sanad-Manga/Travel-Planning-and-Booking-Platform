import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus, CabinClass } from '../../common';
import {
  FlightBookingLean,
} from '../schemas/flight-booking.schema';
import {
  BookingPassengerResponseDto,
  PassengerCountsDto,
  toBookingPassengerResponse,
} from './flight-booking-response.dto';
import { FlightBookingSummarySegmentDto } from './flight-booking-summary-response.dto';
import { FlightResponseDto } from './flight-response.dto';
import { FlightBookingGroup } from './my-flight-bookings-query.dto';

/** One booking document as the FLT-25 aggregation returns it: the booking plus its computed group. */
export interface FlightBookingListRowSource extends FlightBookingLean {
  group: FlightBookingGroup;
}

/** FLT-25: one row of `GET /api/flight-bookings`. */
export class FlightBookingListRowDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' })
  id: string;

  @ApiProperty({
    enum: FlightBookingGroup,
    example: FlightBookingGroup.UPCOMING,
    description:
      'CANCELLED when the booking status is CANCELLED; otherwise UPCOMING/PAST from the outbound segment departure',
  })
  group: FlightBookingGroup;

  @ApiPropertyOptional({
    example: 'FLT-9F2C41A7B3D84E60',
    description:
      'Unique booking reference. Absent while pending payment and on historical confirmed bookings created before FLT-23; it is never generated or backfilled by this list.',
  })
  bookingReference?: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  status: BookingStatus;

  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  cabinClass: CabinClass;

  @ApiProperty({
    type: FlightResponseDto,
    description: 'The outbound flight; its UTC departureAt decides UPCOMING vs PAST',
  })
  flight: FlightResponseDto;

  @ApiProperty({
    type: [FlightBookingSummarySegmentDto],
    description:
      'Outbound then return, each with its flight details; a one-way booking (including legacy bookings without a segments array) has one segment',
  })
  segments: FlightBookingSummarySegmentDto[];

  @ApiProperty({ type: PassengerCountsDto })
  passengerCounts: PassengerCountsDto;

  @ApiProperty({
    type: [BookingPassengerResponseDto],
    description:
      'Passenger names, dates of birth, types and baggage; empty for legacy bookings created before FLT-19',
  })
  passengers: BookingPassengerResponseDto[];

  @ApiProperty({
    example: 45000,
    description: 'Booking total at the time the seats were held, in integer cents',
  })
  totalCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    example: '2026-11-18T10:00:00.000Z',
    description: 'When the booking was created; list rows are ordered by this, newest first',
  })
  createdAt: string;
}

/**
 * Maps one aggregated booking plus its resolved segment flights to the list row. Pure and
 * synchronous so the DTO never depends on a database session; the service resolves `segments`
 * (with `flight`) and the outbound `flight` first. Passport/ID numbers and payment data never
 * reach this function because `getFlightBookingSegments` and the passenger mapper drop them.
 */
export function toFlightBookingListRow(
  doc: FlightBookingListRowSource,
  segments: FlightBookingSummarySegmentDto[],
  flight: FlightResponseDto,
): FlightBookingListRowDto {
  return {
    id: doc._id.toString(),
    group: doc.group,
    ...(doc.bookingReference
      ? { bookingReference: doc.bookingReference }
      : {}),
    status: doc.status,
    cabinClass: doc.cabinClass,
    flight,
    segments,
    passengerCounts: {
      adults: doc.passengerCounts.adults,
      children: doc.passengerCounts.children,
      infants: doc.passengerCounts.infants,
    },
    passengers: (doc.passengers ?? []).map(toBookingPassengerResponse),
    totalCents: doc.totalCents,
    currency: doc.currency,
    createdAt: doc.createdAt.toISOString(),
  };
}
