import { ApiProperty } from '@nestjs/swagger';
import { HotelDocument } from '../schemas/hotel.schema';
import { HotelPhotoDto } from './create-hotel.dto';

export class HotelResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil' })
  address: string;

  @ApiProperty({ example: 'CAI' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: [HotelPhotoDto] })
  photos: HotelPhotoDto[];

  @ApiProperty({ example: 4 })
  starRating: number;

  @ApiProperty({ type: [String] })
  amenities: string[];

  @ApiProperty({ type: String, nullable: true, example: '14:00', description: 'Standard check-in time (24-hour HH:mm, hotel local time), set by HTL-09. null = not set yet.' })
  checkInTime: string | null;

  @ApiProperty({ type: String, nullable: true, example: '11:00', description: 'Standard check-out time (24-hour HH:mm, hotel local time), set by HTL-09. null = not set yet.' })
  checkOutTime: string | null;

  @ApiProperty({ description: 'false = deactivated by an admin.' })
  isActive: boolean;

  @ApiProperty({ example: '2026-11-20T14:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-20T14:30:00.000Z' })
  updatedAt: string;

  static from(hotel: HotelDocument): HotelResponseDto {
    return {
      id: hotel._id.toString(),
      name: hotel.name,
      address: hotel.address,
      cityId: hotel.cityId,
      countryCode: hotel.countryCode,
      description: hotel.description,
      photos: (hotel.photos ?? []).map((p) => ({ id: p.id, url: p.url })),
      starRating: hotel.starRating,
      amenities: [...(hotel.amenities ?? [])],
      checkInTime: hotel.checkInTime ?? null,
      checkOutTime: hotel.checkOutTime ?? null,
      isActive: hotel.isActive,
      createdAt: (hotel.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (hotel.updatedAt ?? new Date(0)).toISOString(),
    };
  }
}
