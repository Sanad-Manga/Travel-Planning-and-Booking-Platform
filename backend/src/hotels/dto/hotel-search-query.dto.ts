import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsCalendarDate, PaginationDto } from '../../common';
import { HOTEL_SEARCH_MAX_GUESTS, HOTEL_SEARCH_MAX_ROOMS } from '../hotels.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimUpper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

/**
 * Query of GET /api/hotels/search (HTL-11). Exactly one of cityId / countryCode, the date order, "not in the past"
 * and "id exists" are business rules, checked in HotelSearchService.
 */
export class HotelSearchQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'CAI', description: 'Seeded city id (city_id). Send this OR countryCode, not both.' })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'cityId must be a string' })
  cityId?: string;

  @ApiPropertyOptional({ example: 'EG', description: 'Seeded country code. Send this OR cityId, not both.' })
  @IsOptional()
  @Transform(trimUpper)
  @IsString({ message: 'countryCode must be a string' })
  countryCode?: string;

  @ApiProperty({ example: '2027-03-10', description: 'First night, YYYY-MM-DD. Today or later (UTC).' })
  @Transform(trim)
  @IsCalendarDate()
  checkIn: string;

  @ApiProperty({ example: '2027-03-13', description: 'Check-out day, YYYY-MM-DD, after checkIn. It is not a night of the stay.' })
  @Transform(trim)
  @IsCalendarDate()
  checkOut: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: HOTEL_SEARCH_MAX_GUESTS, description: 'Total number of guests.' })
  @Type(() => Number)
  @IsInt({ message: 'guests must be a whole number' })
  @Min(1, { message: 'guests must be at least 1' })
  @Max(HOTEL_SEARCH_MAX_GUESTS, { message: `guests must be at most ${HOTEL_SEARCH_MAX_GUESTS}` })
  guests: number;

  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: HOTEL_SEARCH_MAX_ROOMS, default: 1, description: 'Number of rooms. Defaults to 1.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'rooms must be a whole number' })
  @Min(1, { message: 'rooms must be at least 1' })
  @Max(HOTEL_SEARCH_MAX_ROOMS, { message: `rooms must be at most ${HOTEL_SEARCH_MAX_ROOMS}` })
  rooms: number = 1;
}
