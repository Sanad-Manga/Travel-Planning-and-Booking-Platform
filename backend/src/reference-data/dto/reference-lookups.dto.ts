import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';
import { PaginationDto } from '../../common';

export class CountryResponseDto {
  @ApiProperty({
    example: 'EG',
    description: 'Official Countries.csv country code.',
  })
  code: string;

  @ApiProperty({ example: 'Egypt' })
  name: string;

  @ApiProperty({
    example: 'EGP',
    description: 'Official currency code of the country.',
  })
  currency: string;
}

export class CityResponseDto {
  @ApiProperty({
    example: 'cairo',
    description: 'Official Cities.csv city_id; not a MongoDB ObjectId.',
  })
  cityId: string;

  @ApiProperty({ example: 'Cairo' })
  name: string;

  @ApiProperty({ example: 'EG', description: 'Official country code.' })
  countryCode: string;
}

export class CurrencyResponseDto {
  @ApiProperty({
    example: 'EGP',
    description: 'Official Currencies.csv currency code.',
  })
  code: string;
}

/** `GET /api/cities?countryCode=EG&page=1&limit=10`. */
export class CitiesQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'EG',
    description:
      'Only cities of this country (two-letter official code, any letter case). A well-formed code that no country uses gives an empty page.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be a two-letter country code such as EG',
  })
  countryCode?: string;
}
