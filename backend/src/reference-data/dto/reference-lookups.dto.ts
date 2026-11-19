import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';
import { PaginationDto } from '../../common';

export class CitiesQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'EG',
    pattern: '^[A-Z]{2}$',
    description:
      'Filter by country code. Spaces are trimmed and letters are uppercased. Unknown codes return an empty page.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be a two-letter country code',
  })
  countryCode?: string;
}

export class CountryResponseDto {
  @ApiProperty({ example: 'EG' })
  code: string;

  @ApiProperty({ example: 'Egypt' })
  name: string;

  @ApiProperty({ example: 'EGP' })
  currency: string;
}

export class CityResponseDto {
  @ApiProperty({ example: 'cairo', description: 'Official city identifier.' })
  city_id: string;

  @ApiProperty({ example: 'Cairo' })
  name: string;

  @ApiProperty({ example: 'EG' })
  country_code: string;
}

export class CurrencyResponseDto {
  @ApiProperty({ example: 'EGP' })
  code: string;
}
