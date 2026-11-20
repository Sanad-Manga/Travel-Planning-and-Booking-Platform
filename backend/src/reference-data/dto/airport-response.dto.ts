import { ApiProperty } from '@nestjs/swagger';

export class AirportCityDto {
  @ApiProperty({
    example: 'cairo',
    description: 'Official Cities.csv city_id; not a MongoDB ObjectId.',
  })
  cityId: string;

  @ApiProperty({ example: 'Cairo' })
  name: string;
}

export class AirportCountryDto {
  @ApiProperty({
    example: 'EG',
    description: 'Official Countries.csv country code.',
  })
  code: string;

  @ApiProperty({ example: 'Egypt' })
  name: string;
}

export class AirportResponseDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Internal MongoDB identifier represented as a string.',
  })
  id: string;

  @ApiProperty({
    example: 'CAI',
    description:
      'Original official IATA identifier. Use this code when referencing the airport.',
  })
  iataCode: string;

  @ApiProperty({ example: 'Cairo International Airport' })
  name: string;

  @ApiProperty({ type: AirportCityDto })
  city: AirportCityDto;

  @ApiProperty({ type: AirportCountryDto })
  country: AirportCountryDto;

  @ApiProperty({
    example: 'Africa/Cairo',
    description:
      'IANA time-zone identifier preserved from Airports.csv, not a fixed UTC offset.',
  })
  timeZone: string;
}
