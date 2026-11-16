import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsMongoId, Min, ValidateNested } from 'class-validator';
import { IsCalendarDate } from '../../common';
import { HOTEL_SEARCH_MAX_ROOMS } from '../hotels.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class HotelBookingRoomDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182940', description: 'Room id returned by GET /api/hotels/:id/rooms/available.' })
  @Transform(trim)
  @IsMongoId()
  roomId: string;

  @ApiProperty({ example: 2, minimum: 0, description: 'Number of adults assigned to this room.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  adults: number;

  @ApiProperty({ example: 1, minimum: 0, description: 'Number of children aged 0-17 assigned to this room.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  children: number;
}

export class CreateHotelBookingDto {
  @ApiProperty({ example: '2027-03-10', description: 'Check-in date, YYYY-MM-DD.' })
  @Transform(trim)
  @IsCalendarDate()
  checkIn: string;

  @ApiProperty({ example: '2027-03-13', description: 'Check-out date, YYYY-MM-DD.' })
  @Transform(trim)
  @IsCalendarDate()
  checkOut: string;

  @ApiProperty({ type: [HotelBookingRoomDto], minItems: 1, maxItems: HOTEL_SEARCH_MAX_ROOMS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(HOTEL_SEARCH_MAX_ROOMS)
  @ArrayUnique((room: HotelBookingRoomDto) => room.roomId)
  @ValidateNested({ each: true })
  @Type(() => HotelBookingRoomDto)
  rooms: HotelBookingRoomDto[];
}
