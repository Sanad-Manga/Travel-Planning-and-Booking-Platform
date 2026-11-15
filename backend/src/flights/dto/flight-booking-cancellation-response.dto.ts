import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../../common';
import { FlightBookingSegmentResponseDto } from './flight-booking-response.dto';

export class FlightBookingCancellationResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' })
  id: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CANCELLED })
  status: BookingStatus;

  @ApiProperty({
    example: 0,
    description:
      'Refund calculated from the outbound airline policy, in integer cents',
  })
  refundAmountCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    type: [FlightBookingSegmentResponseDto],
    description: 'All cancelled segments; their booked seats have been released',
  })
  segments: FlightBookingSegmentResponseDto[];
}
