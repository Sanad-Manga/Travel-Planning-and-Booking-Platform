import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Body of `PATCH /api/flight-bookings/:id/seat` (FLT-28). */
export class SelectSeatDto {
  @ApiProperty({
    example: '12A',
    description:
      'Seat label in the booked cabin: row number then a letter A-F (rows of six). It must exist in that cabin and be free.',
  })
  @Transform(trimUpper)
  @IsString({ message: 'seat must be a string' })
  @Matches(/^[1-9]\d{0,3}[A-F]$/, {
    message: 'seat must be a row number followed by a letter A-F, such as 12A',
  })
  seat: string;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    default: 0,
    description:
      'Which passenger of the booking the seat is for (0 = the first passenger in the booking). Infants take no seat.',
  })
  @IsOptional()
  @IsInt({ message: 'passengerIndex must be a whole number' })
  @Min(0, { message: 'passengerIndex must be 0 or more' })
  passengerIndex?: number;

  @ApiPropertyOptional({
    description:
      'Which flight of a round trip the seat is for. Omit it for the outbound flight (or a one-way booking).',
  })
  @IsOptional()
  @IsMongoId({ message: 'flightId must be a valid id' })
  flightId?: string;
}

export class SeatSelectionDto {
  @ApiProperty() flightId: string;
  @ApiProperty({ example: 0 }) passengerIndex: number;
  @ApiProperty({ example: '12A' }) seat: string;
}

export class SelectSeatResponseDto {
  @ApiProperty() bookingId: string;
  @ApiProperty({
    type: [SeatSelectionDto],
    description: 'All seats chosen so far on this booking.',
  })
  seatSelections: SeatSelectionDto[];
}

export enum SeatStatus {
  FREE = 'FREE',
  TAKEN = 'TAKEN',
  /** Held by a passenger of this same booking. */
  YOURS = 'YOURS',
}

export class SeatMapSeatDto {
  @ApiProperty({ example: '12A' }) seat: string;
  @ApiProperty({ enum: SeatStatus, example: SeatStatus.FREE })
  status: SeatStatus;
}

export class SeatMapQueryDto {
  @ApiPropertyOptional({
    description:
      'Which flight of a round trip to show. Omit it for the outbound flight (or a one-way booking).',
  })
  @IsOptional()
  @IsMongoId({ message: 'flightId must be a valid id' })
  flightId?: string;
}

export class SeatMapResponseDto {
  @ApiProperty() bookingId: string;
  @ApiProperty() flightId: string;
  @ApiProperty({ example: 'ECONOMY' }) cabinClass: string;
  @ApiProperty({
    type: [SeatMapSeatDto],
    description:
      'Every seat of the booked cabin in row order. TAKEN seats show nobody: no name or booking is revealed.',
  })
  seats: SeatMapSeatDto[];
}
