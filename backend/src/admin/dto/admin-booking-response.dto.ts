import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus, BookingType } from '../../common';

class BookingPartyDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null if the referenced record is missing.',
  })
  name: string | null;
}

export class AdminBookingResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: BookingType })
  type: BookingType;

  @ApiProperty({ type: String, nullable: true })
  bookingReference: string | null;

  @ApiProperty({ type: BookingPartyDto })
  user: BookingPartyDto;

  @ApiProperty({
    type: BookingPartyDto,
    description: 'Airline for flights, hotel for reservations.',
  })
  provider: BookingPartyDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Outbound departure (UTC ISO timestamp) or hotel check-in (YYYY-MM-DD). Null if unavailable.',
  })
  startDate: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Last segment arrival (UTC ISO timestamp) or hotel check-out (YYYY-MM-DD). Null if unavailable.',
  })
  endDate: string | null;

  @ApiProperty({
    type: Number,
    description: 'Stored booking amount in integer cents.',
  })
  totalCents: number;

  @ApiProperty({ type: String })
  currency: string;

  @ApiProperty({ enum: BookingStatus })
  status: BookingStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;
}
