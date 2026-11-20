import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  ROOM_MAX_BEDS,
  ROOM_MAX_OCCUPANCY,
  ROOM_MAX_PRICE_CENTS,
  ROOM_NAME_MAX_LENGTH,
  ROOM_TYPE_MAX_LENGTH,
} from '../hotels.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateRoomDto {
  @ApiProperty({ description: 'Room number or name, unique within the hotel (case-insensitive).', example: '101', maxLength: ROOM_NAME_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROOM_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({ description: 'Room type, free text.', example: 'Double', maxLength: ROOM_TYPE_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROOM_TYPE_MAX_LENGTH)
  type: string;

  @ApiProperty({ minimum: 1, maximum: ROOM_MAX_BEDS, example: 2 })
  @IsInt()
  @Min(1)
  @Max(ROOM_MAX_BEDS)
  beds: number;

  @ApiProperty({ description: 'Maximum number of guests (>= 1).', minimum: 1, maximum: ROOM_MAX_OCCUPANCY, example: 3 })
  @IsInt()
  @Min(1)
  @Max(ROOM_MAX_OCCUPANCY)
  maxOccupancy: number;

  @ApiProperty({
    description: 'Price per night in integer cents of the platform currency (> 0). 8500 = 85.00.',
    minimum: 1,
    maximum: ROOM_MAX_PRICE_CENTS,
    example: 8500,
  })
  @IsInt()
  @Min(1)
  @Max(ROOM_MAX_PRICE_CENTS)
  pricePerNightCents: number;
}
