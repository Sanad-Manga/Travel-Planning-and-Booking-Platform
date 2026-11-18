import { ApiProperty } from '@nestjs/swagger';
import { BookingType, RefundStatus } from '../../common';
import { RefundSummary } from '../refund-summary';

/** GET /api/refunds/:id response (PAY-03). */
export class RefundResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d05' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  bookingType: BookingType;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' })
  bookingId: string;

  @ApiProperty({ enum: RefundStatus, example: RefundStatus.REFUNDED })
  status: RefundStatus;

  @ApiProperty({ example: 12500, description: 'Integer minor units (cents).' })
  amountCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ required: false, example: 'Cancelled per tier 2' })
  reason?: string;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  createdAt: Date;
}

export function toRefundResponse(refund: RefundSummary): RefundResponseDto {
  return refund;
}
