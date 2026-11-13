import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus, CabinClass } from '../../common';
import {
  BookingPassengerResponseDto,
  PassengerCountsDto,
} from './flight-booking-response.dto';
import { FlightResponseDto } from './flight-response.dto';

export class FlightBookingSummaryResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' })
  id: string;

  @ApiProperty({ type: FlightResponseDto })
  flight: FlightResponseDto;

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
    description: 'UTC hold expiry time',
  })
  holdExpiresAt: string | null;
}
