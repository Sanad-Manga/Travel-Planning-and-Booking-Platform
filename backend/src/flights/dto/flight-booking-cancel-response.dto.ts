import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common';
import { FlightBookingRefundDto } from './flight-booking-summary-response.dto';

/** The tier that decided the refund; null when no tier applies (zero refund). */
export class FlightCancellationTierDto {
  @ApiProperty({
    example: 30,
    description:
      'Days-before-departure threshold of the applied airline tier (the highest one not above the fractional days before departure)',
  })
  daysBeforeThreshold: number;

  @ApiProperty({ example: 50, description: 'Percentage of the booking total refunded' })
  refundPercent: number;
}

/**
 * Response of `POST /api/flight-bookings/:id/cancel` (FLT-26), for both the preview
 * (`confirm: false`) and the completed cancellation (`confirm: true`).
 */
export class FlightBookingCancelResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' })
  id: string;

  @ApiProperty({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
    description:
      'CONFIRMED on a preview; CANCELLED after a successful confirmation',
  })
  status: BookingStatus;

  @ApiProperty({
    example: false,
    description:
      'false on a preview (nothing changed); true after the booking was cancelled and its seats returned',
  })
  cancelled: boolean;

  @ApiPropertyOptional({
    example: 'FLT-9F2C41A7B3D84E60',
    description:
      'Unique booking reference when the booking has one; absent on historical bookings confirmed before FLT-23',
  })
  bookingReference?: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    example: 45000,
    description:
      'The booking total the refund percentage is applied to, in integer cents',
  })
  totalCents: number;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d0e',
    description:
      'The outbound segment flight; a round trip is cancelled as a whole by this segment',
  })
  outboundFlightId: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d01',
    description:
      'The booking stored outbound airline, whose cancellation tiers decide the refund',
  })
  outboundAirlineId: string;

  @ApiProperty({
    example: '2026-12-01T12:30:00.000Z',
    description: 'Outbound departure (UTC), the cutoff for cancelling',
  })
  outboundDepartureAt: string;

  @ApiProperty({
    example: 30.5,
    description:
      'Fractional days between now and the outbound departure (the refund uses this value, not a whole-day count). Negative only when completing a refund for a booking that was already cancelled before its departure.',
  })
  daysBefore: number;

  @ApiProperty({
    example: 22500,
    minimum: 0,
    description:
      'Calculated refund in integer cents. 0 means the booking is cancelled without a refund: PAY-03 is not called and refund is null.',
  })
  refundAmountCents: number;

  @ApiProperty({
    example: 50,
    minimum: 0,
    maximum: 100,
    description:
      'Refund percentage of the applied tier; 0 when no tier applies. When completing a previously failed refund it is derived from the recorded amount because the tier is not re-read.',
  })
  refundPercent: number;

  @ApiPropertyOptional({
    type: FlightCancellationTierDto,
    nullable: true,
    description:
      'The airline tier used for the calculation; null when no tier applies (zero refund) or when completing a refund that failed earlier (only the recorded amount is used, never a freshly selected tier).',
  })
  appliedTier: FlightCancellationTierDto | null;

  @ApiPropertyOptional({
    type: FlightBookingRefundDto,
    nullable: true,
    description:
      "The refund PAY-03 issued through RefundsService.issue. Null on a preview and when the refund is zero (PAY-03 requires a positive integer amount, so no zero-value refund exists).",
  })
  refund: FlightBookingRefundDto | null;
}
