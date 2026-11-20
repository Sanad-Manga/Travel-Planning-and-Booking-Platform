import { ApiProperty } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../common';
import { RoomDocument } from '../schemas/room.schema';

export class RoomResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182940' })
  id: string;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  hotelId: string;

  @ApiProperty({ example: '101' })
  name: string;

  @ApiProperty({ example: 'Double' })
  type: string;

  @ApiProperty({ example: 2 })
  beds: number;

  @ApiProperty({ example: 3 })
  maxOccupancy: number;

  @ApiProperty({ description: 'Integer cents of the platform currency.', example: 8500 })
  pricePerNightCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ description: 'false = taken out of sale.' })
  isActive: boolean;

  @ApiProperty({ example: '2026-11-20T14:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-20T14:30:00.000Z' })
  updatedAt: string;

  static from(room: RoomDocument): RoomResponseDto {
    return {
      id: room._id.toString(),
      hotelId: room.hotelId.toString(),
      name: room.name,
      type: room.type,
      beds: room.beds,
      maxOccupancy: room.maxOccupancy,
      pricePerNightCents: room.pricePerNightCents,
      currency: PLATFORM_CURRENCY,
      isActive: room.isActive,
      createdAt: (room.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (room.updatedAt ?? new Date(0)).toISOString(),
    };
  }
}
