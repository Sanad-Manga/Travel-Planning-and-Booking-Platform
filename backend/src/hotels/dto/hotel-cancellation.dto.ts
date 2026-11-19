import { ApiProperty } from '@nestjs/swagger';
import { BookingType, RefundStatus } from '../../common';
import { HotelBookingResponseDto } from './hotel-booking-response.dto';

/** HTL-21: what cancelling a reservation would refund right now. Nothing is changed by asking. */
export class HotelCancellationPreviewDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  bookingId: string;

  @ApiProperty({ example: '2027-03-10' })
  checkIn: string;

  @ApiProperty({
    example: '2027-03-10T15:00:00.000Z',
    description: 'The moment the stay starts (UTC): the check-in date at the hotel check-in time, or 00:00 when the hotel set none. Cancelling is only possible before it.',
  })
  checkInAt: string;

  @ApiProperty({ example: 12.5, description: 'Days from now to checkInAt, fractional. The hotel cancellation tiers are applied to this number.' })
  daysBeforeCheckIn: number;

  @ApiProperty({ example: 25500, description: 'The full reservation total, in cents.' })
  totalCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 12750, description: 'What the traveler gets back: the tier percentage of the full total, in cents. 0 when no tier applies.' })
  refundCents: number;

  @ApiProperty({ example: 12750, description: 'totalCents minus refundCents.' })
  nonRefundableCents: number;
}

/** The refund PAY-03 created for the cancellation (the fields the traveler needs). */
export class HotelCancellationRefundDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182960' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.HOTEL })
  bookingType: BookingType;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  bookingId: string;

  @ApiProperty({ enum: RefundStatus, example: RefundStatus.REFUNDED })
  status: RefundStatus;

  @ApiProperty({ example: 12750, description: 'Integer cents.' })
  amountCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: '2026-11-19T10:00:00.000Z' })
  createdAt: Date;
}

/** HTL-21: the cancelled reservation and its refund. */
export class HotelCancellationResultDto {
  @ApiProperty({ type: HotelBookingResponseDto, description: 'The reservation, now CANCELLED. Its rooms are free again.' })
  booking: HotelBookingResponseDto;

  @ApiProperty({
    type: HotelCancellationRefundDto,
    nullable: true,
    description: 'The refund created through PAY-03, or null when no hotel tier applied (nothing is refunded).',
  })
  refund: HotelCancellationRefundDto | null;
}
