import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

/** Body of `POST /api/flights/:id/cancel` (FLT-06). Cancelling is destructive, so it needs an explicit yes. */
export class CancelFlightDto {
  @ApiProperty({
    example: true,
    description:
      'Must be true. Cancelling a flight cancels every booking on it and refunds them in full, so a missing or false value is rejected and nothing changes.',
  })
  @IsBoolean({ message: 'confirm must be true or false' })
  @Equals(true, { message: 'confirm must be true to cancel the flight' })
  confirm: boolean;
}

export class FlightCancellationFailureDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  bookingId: string;

  @ApiProperty({
    example: 'The refund could not be issued yet',
    description: 'What is left to do for this booking',
  })
  message: string;
}

export class FlightCancellationResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  flightId: string;

  @ApiProperty({ example: 'CANCELLED', description: 'Always CANCELLED' })
  status: string;

  @ApiProperty({
    example: 12,
    description: 'CONFIRMED bookings cancelled by this call',
  })
  bookingsCancelled: number;

  @ApiProperty({
    example: 2,
    description: 'Unpaid PENDING_PAYMENT holds released by this call',
  })
  holdsReleased: number;

  @ApiProperty({
    example: 12,
    description: 'Refunds issued (or already issued) for cancelled bookings',
  })
  refundsIssued: number;

  @ApiProperty({
    example: 540000,
    description:
      'Sum of the refunds issued, integer cents (100% of each booking)',
  })
  refundedCents: number;

  @ApiProperty({
    example: 12,
    description: 'Passengers notified (BOOKING_CANCELLED)',
  })
  passengersNotified: number;

  @ApiProperty({
    example: true,
    description:
      'False when some booking still needs work (see pending). The flight is cancelled either way; send the same request again to finish.',
  })
  complete: boolean;

  @ApiProperty({
    type: [FlightCancellationFailureDto],
    description:
      'Bookings whose refund, cancellation or hold release did not finish; repeating the request retries exactly these',
  })
  pending: FlightCancellationFailureDto[];
}
