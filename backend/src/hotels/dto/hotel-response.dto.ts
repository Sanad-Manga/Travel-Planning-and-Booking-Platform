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
      isActive: hotel.isActive,
      createdAt: (hotel.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (hotel.updatedAt ?? new Date(0)).toISOString(),
    };
  }
}
