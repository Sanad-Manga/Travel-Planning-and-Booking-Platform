import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { ITINERARY_TITLE_MAX_LENGTH } from '../../common';
import { IsCalendarDate } from './is-calendar-date.decorator';

/** More than the number of countries in the seed. Stops a huge array from causing thousands of lookups. */
export const ITINERARY_MAX_COUNTRIES = 250;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimUpperEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item: unknown) =>
        typeof item === 'string' ? item.trim().toUpperCase() : item,
      )
    : value;

/**
 * Body of POST /api/itineraries (ITN-01).
 * `authorId`, `visibility`, `isHidden` and ids are not accepted: the server sets them.
 */
export class CreateItineraryDto {
  @ApiProperty({
    example: 'Two weeks in Egypt and the UAE',
    maxLength: ITINERARY_TITLE_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString({ message: 'title must be a string' })
  @IsNotEmpty({ message: 'title should not be empty' })
  @MaxLength(ITINERARY_TITLE_MAX_LENGTH, {
    message: `title must be at most ${ITINERARY_TITLE_MAX_LENGTH} characters`,
  })
  title: string;

  @ApiProperty({
    example: ['EG', 'AE'],
    type: [String],
    minItems: 1,
    description:
      'One or more country codes from the seeded country list (see the reference data). Stored upper-case.',
  })
  @Transform(trimUpperEach)
  @IsArray({ message: 'countryCodes must be an array' })
  @ArrayMinSize(1, {
    message: 'countryCodes must contain at least one country',
  })
  @ArrayMaxSize(ITINERARY_MAX_COUNTRIES, {
    message: `countryCodes must contain at most ${ITINERARY_MAX_COUNTRIES} countries`,
  })
  @ArrayUnique({ message: 'countryCodes must not contain duplicates' })
  @IsString({ each: true, message: 'each country code must be a string' })
  @IsNotEmpty({ each: true, message: 'a country code should not be empty' })
  countryCodes: string[];

  @ApiProperty({
    example: '2026-12-20',
    description:
      'The trip start date, `YYYY-MM-DD`. Day dates are derived from it.',
  })
  @Transform(trim)
  @IsCalendarDate()
  startDate: string;
}
