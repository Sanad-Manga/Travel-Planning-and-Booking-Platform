import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Matches, Min } from 'class-validator';
import { PaginationDto } from '../../common';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Query of GET /api/flights/search (FLT-11). Business rules (real date, known airports) are in the service. */
export class FlightSearchQueryDto extends PaginationDto {
  @ApiProperty({ example: 'CAI', description: 'IATA code of a seeded airport' })
  @Transform(trimUpper)
  @IsString({ message: 'departureAirport must be a string' })
  @Matches(/^[A-Z]{3}$/, {
    message: 'departureAirport must be a 3-letter IATA code',
  })
  departureAirport: string;

  @ApiProperty({ example: 'JFK', description: 'IATA code of a seeded airport' })
  @Transform(trimUpper)
  @IsString({ message: 'arrivalAirport must be a string' })
  @Matches(/^[A-Z]{3}$/, {
    message: 'arrivalAirport must be a 3-letter IATA code',
  })
  arrivalAirport: string;

  @ApiProperty({
    example: '2026-12-01',
    description: 'Departure date as the LOCAL date at the departure airport (YYYY-MM-DD)',
  })
  @Transform(trim)
  @IsString({ message: 'departureDate must be a string' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'departureDate must be YYYY-MM-DD',
  })
  departureDate: string;

  @ApiProperty({ example: 2, minimum: 1, description: 'Number of passengers who need a seat' })
  @Type(() => Number)
  @IsInt({ message: 'passengers must be a whole number' })
  @Min(1, { message: 'passengers must be at least 1' })
  passengers: number;
}