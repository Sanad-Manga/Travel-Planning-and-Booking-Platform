import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ITINERARY_MAX_DAYS, PaginationDto } from '../../common';

/** Longest keyword accepted. Not set by the requirements; stops a huge string from reaching the database. */
export const SEARCH_KEYWORD_MAX_LENGTH = 100;
const CITY_ID_MAX_LENGTH = 100;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimAndUpperCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Query of GET /api/itineraries/public/search (ITN-20, ITN-21): `page` and `limit` (page size 10 by default), a
 * keyword and the filters. All the filters that are sent must match at the same time.
 */
export class PublicSearchQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'nile',
    maxLength: SEARCH_KEYWORD_MAX_LENGTH,
    description:
      'Keyword, matched as plain text and ignoring case, in the title, the name of one of its countries or the name of a city it visits',
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'q must be a string' })
  @MaxLength(SEARCH_KEYWORD_MAX_LENGTH, {
    message: `q must be at most ${SEARCH_KEYWORD_MAX_LENGTH} characters`,
  })
  q?: string;

  @ApiPropertyOptional({
    example: 3,
    minimum: 1,
    maximum: ITINERARY_MAX_DAYS,
    description: 'Only itineraries with at least this many days',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minDays must be a whole number' })
  @Min(1, { message: 'minDays must be at least 1' })
  @Max(ITINERARY_MAX_DAYS, {
    message: `minDays must be at most ${ITINERARY_MAX_DAYS}`,
  })
  minDays?: number;

  @ApiPropertyOptional({
    example: 10,
    minimum: 1,
    maximum: ITINERARY_MAX_DAYS,
    description: 'Only itineraries with at most this many days',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxDays must be a whole number' })
  @Min(1, { message: 'maxDays must be at least 1' })
  @Max(ITINERARY_MAX_DAYS, {
    message: `maxDays must be at most ${ITINERARY_MAX_DAYS}`,
  })
  maxDays?: number;

  @ApiPropertyOptional({
    example: 'EG',
    description:
      'Only itineraries that include this country (official code, lower case is accepted)',
  })
  @IsOptional()
  @Transform(trimAndUpperCase)
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be a 2-letter country code, e.g. EG',
  })
  countryCode?: string;

  @ApiPropertyOptional({
    example: 'cairo',
    description: 'Only itineraries with a day in this city (official city_id)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'cityId must be a string' })
  @MaxLength(CITY_ID_MAX_LENGTH, {
    message: `cityId must be at most ${CITY_ID_MAX_LENGTH} characters`,
  })
  cityId?: string;
}
