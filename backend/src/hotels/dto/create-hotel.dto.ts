import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_IMAGES_PER_ENTITY } from '../../common';
import {
  HOTEL_ADDRESS_MAX_LENGTH,
  HOTEL_AMENITY_MAX_LENGTH,
  HOTEL_DESCRIPTION_MAX_LENGTH,
  HOTEL_MAX_AMENITIES,
  HOTEL_MAX_STARS,
  HOTEL_MIN_STARS,
  HOTEL_NAME_MAX_LENGTH,
} from '../hotels.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Trim, drop blanks and case-insensitive duplicates ("Wifi", "wifi ") before validation.
const cleanAmenities = ({ value }: { value: unknown }) => {
  if (!Array.isArray(value)) return value;
  const seen = new Set<unknown>();
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => {
      if (v === '') return false;
      const key = typeof v === 'string' ? v.toLowerCase() : v;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export class HotelPhotoDto {
  @ApiProperty({ description: 'Id returned by the Upload service (GEN-08).', example: '6730a1f2c3d4e5f607182931' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  id: string;

  @ApiProperty({ description: 'Url returned by the Upload service (GEN-08).', example: '/uploads/hotels/6730a1f2.jpg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url: string;
}

export class CreateHotelDto {
  @ApiProperty({ example: 'Nile View Hotel', maxLength: HOTEL_NAME_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil', maxLength: HOTEL_ADDRESS_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_ADDRESS_MAX_LENGTH)
  address: string;

  @ApiProperty({ description: 'A seeded city id (`city_id`). The country is taken from the city.', example: 'CAI' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  cityId: string;

  @ApiProperty({ example: 'Riverside hotel close to the museums.', maxLength: HOTEL_DESCRIPTION_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(HOTEL_DESCRIPTION_MAX_LENGTH)
  description: string;

  @ApiProperty({ minimum: HOTEL_MIN_STARS, maximum: HOTEL_MAX_STARS, example: 4 })
  @IsInt()
  @Min(HOTEL_MIN_STARS)
  @Max(HOTEL_MAX_STARS)
  starRating: number;

  @ApiPropertyOptional({ type: [String], example: ['Wifi', 'Pool'], maxItems: HOTEL_MAX_AMENITIES })
  @IsOptional()
  @Transform(cleanAmenities)
  @IsArray()
  @ArrayMaxSize(HOTEL_MAX_AMENITIES)
  @IsString({ each: true })
  @MaxLength(HOTEL_AMENITY_MAX_LENGTH, { each: true })
  amenities?: string[];

  @ApiPropertyOptional({
    type: [HotelPhotoDto],
    maxItems: MAX_IMAGES_PER_ENTITY,
    description: 'Photos already uploaded through the Upload service (JPG/PNG, 5 MB, max 5 per hotel).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES_PER_ENTITY)
  @ValidateNested({ each: true })
  @Type(() => HotelPhotoDto)
  @ArrayUnique((p: HotelPhotoDto) => p.id)
  photos?: HotelPhotoDto[];
}
