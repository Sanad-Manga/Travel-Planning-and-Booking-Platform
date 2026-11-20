import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsCalendarDate, PaginationDto } from '../../common';
import { HOTEL_SEARCH_MAX_GUESTS, HOTEL_SEARCH_MAX_ROOMS } from '../hotels.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimUpper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

/** What the results can be sorted by (HTL-12). Same names as the flight search (FLT-15). */
export enum HotelSortBy {
  PRICE = 'price',
  RATING = 'rating',
}

export enum HotelSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * Query of GET /api/hotels/search (HTL-11, HTL-12). Exactly one of cityId / countryCode, the date order, "not in the
 * past", "id exists" and "minPrice not above maxPrice" are business rules, checked in HotelSearchService.
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

  @ApiPropertyOptional({
    example: 4,
    minimum: 1,
    maximum: 5,
    description:
      'Inclusive minimum average review rating (a decimal such as 4.5 is allowed). Hotels with no rating are excluded when this is set. "rating" in sort refers to the same value.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'minRating must be a number' })
  @Min(1, { message: 'minRating must be at least 1' })
  @Max(5, { message: 'minRating must be at most 5' })
  minRating?: number;

  @ApiPropertyOptional({
    example: 5000,
    minimum: 0,
    description:
      'Inclusive minimum price per night in integer cents, taken from the cheapest qualifying room (or cheapest combination of rooms when rooms > 1).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minPrice must be a whole number of cents' })
  @Min(0, { message: 'minPrice must be 0 or more' })
  minPrice?: number;

  @ApiPropertyOptional({
    example: 20000,
    minimum: 0,
    description: 'Inclusive maximum price per night in integer cents, using the same cheapest qualifying price.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxPrice must be a whole number of cents' })
  @Min(0, { message: 'maxPrice must be 0 or more' })
  maxPrice?: number;

  // Optional with a default so code that reuses the DTO type (ITN-25 builds the query itself) keeps compiling; the
  // search applies the same defaults when they are absent.
  @ApiPropertyOptional({
    enum: HotelSortBy,
    default: HotelSortBy.PRICE,
    description:
      'Sort key. "price" uses the cheapest qualifying price per night (the same price minPrice/maxPrice filter); "rating" uses the average review rating, with unrated hotels always last.',
  })
  @IsOptional()
  @IsEnum(HotelSortBy, { message: 'sort must be one of: price, rating' })
  sort?: HotelSortBy = HotelSortBy.PRICE;

  @ApiPropertyOptional({ enum: HotelSortOrder, default: HotelSortOrder.ASC, description: 'Sort direction.' })
  @IsOptional()
  @IsEnum(HotelSortOrder, { message: 'order must be one of: asc, desc' })
  order?: HotelSortOrder = HotelSortOrder.ASC;
}
