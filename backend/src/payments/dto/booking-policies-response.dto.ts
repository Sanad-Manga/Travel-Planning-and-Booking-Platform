import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingType } from '../../common';
import { BaggagePolicyResponseDto } from '../../airlines/dto/baggage-policy.dto';

/** One cancellation tier, as returned by either provider's policy getter (FLT-09/HTL-10). */
export class PolicyCancellationTierDto {
  @ApiProperty({
    description: 'Days-before-departure/check-in at or after which this tier applies.',
    example: 7,
  })
  daysBeforeThreshold: number;

  @ApiProperty({
    description: 'Share of the booking total that is refunded, 0-100.',
    example: 50,
  })
  refundPercent: number;
}

/**
 * GET /api/bookings/:type/:id/policies response (PAY-02). `baggagePolicy` is populated only
 * for a FLIGHT booking; `checkInTime`/`checkOutTime` only for a HOTEL booking.
 */
export class BookingPoliciesResponseDto {
  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  bookingType: BookingType;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' })
  bookingId: string;

  @ApiProperty({
    type: [PolicyCancellationTierDto],
    description: 'Largest threshold first. [] = nothing is refunded.',
  })
  cancellationTiers: PolicyCancellationTierDto[];

  @ApiPropertyOptional({
    type: BaggagePolicyResponseDto,
    nullable: true,
    description:
      'FLIGHT only: the airline baggage policy, or null if it has not set one. Absent for a HOTEL booking.',
  })
  baggagePolicy?: BaggagePolicyResponseDto | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '14:00',
    description:
      'HOTEL only: standard check-in time (24-hour HH:mm). Absent for a FLIGHT booking.',
  })
  checkInTime?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '11:00',
    description:
      'HOTEL only: standard check-out time (24-hour HH:mm). Absent for a FLIGHT booking.',
  })
  checkOutTime?: string | null;
}
