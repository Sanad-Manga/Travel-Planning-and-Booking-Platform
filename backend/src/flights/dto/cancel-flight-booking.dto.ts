import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, Min, ValidateIf } from 'class-validator';

/**
 * Body of `POST /api/flight-bookings/:id/cancel` (FLT-26). The same endpoint is called twice:
 *
 * 1. `{ "confirm": false }` previews the airline-tier refund and changes nothing.
 * 2. `{ "confirm": true, "expectedRefundAmountCents": <the preview amount> }` cancels the booking
 *    and issues the refund. The amount is required so a changed policy or clock cannot cancel the
 *    booking for an amount the traveler never saw; a missing amount is a validation error, never
 *    consent.
 */
export class CancelFlightBookingDto {
  @ApiProperty({
    example: false,
    description:
      'false previews the refund without changing anything; true cancels the booking and issues the refund. Required: a missing value is a validation error, not consent.',
  })
  @IsBoolean({ message: 'confirm must be true or false' })
  confirm: boolean;

  @ApiPropertyOptional({
    example: 22500,
    minimum: 0,
    description:
      'Required when confirm is true: the exact refundAmountCents returned by the preview. A different current amount answers 409 and changes nothing. When completing a refund that failed after the booking was cancelled, it must equal the amount recorded at that cancellation (the retry never recalculates or replaces it).',
  })
  @ValidateIf((dto: CancelFlightBookingDto) => dto.confirm === true)
  @IsInt({
    message: 'expectedRefundAmountCents must be a whole number of cents',
  })
  @Min(0, { message: 'expectedRefundAmountCents must be 0 or more' })
  expectedRefundAmountCents?: number;
}
