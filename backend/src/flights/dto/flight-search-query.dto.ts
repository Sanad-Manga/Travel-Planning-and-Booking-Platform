import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { PaginationDto } from '../../common';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** What the results can be sorted by (FLT-15). */
export enum FlightSortBy {
  PRICE = 'price',
  DURATION = 'duration',
  DEPARTURE_TIME = 'departureTime',
}

export enum FlightSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * Query of GET /api/flights/search (FLT-11, FLT-15).
 * Business rules (real date, known airports, minPrice <= maxPrice) are in the service.
 */
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

  @ApiPropertyOptional({
    example: 40000,
    minimum: 0,
    description: 'Inclusive minimum per-passenger cabin fare, in cents',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minPrice must be a whole number of cents' })
  @Min(0, { message: 'minPrice must be 0 or more' })
  minPrice?: number;

  @ApiPropertyOptional({
    example: 90000,
    minimum: 0,
    description: 'Inclusive maximum per-passenger cabin fare, in cents',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxPrice must be a whole number of cents' })
  @Min(0, { message: 'maxPrice must be 0 or more' })
  maxPrice?: number;

  @ApiPropertyOptional({
    enum: FlightSortBy,
    default: FlightSortBy.DEPARTURE_TIME,
    description: 'Sort key. "price" uses the cheapest cabin that matches the search.',
  })
  @IsOptional()
  @IsEnum(FlightSortBy, {
    message: 'sort must be one of: price, duration, departureTime',
  })
  sort: FlightSortBy = FlightSortBy.DEPARTURE_TIME;

  @ApiPropertyOptional({ enum: FlightSortOrder, default: FlightSortOrder.ASC })
  @IsOptional()
  @IsEnum(FlightSortOrder, { message: 'order must be one of: asc, desc' })
  order: FlightSortOrder = FlightSortOrder.ASC;
}
