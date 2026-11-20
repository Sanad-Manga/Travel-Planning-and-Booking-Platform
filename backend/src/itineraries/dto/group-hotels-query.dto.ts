import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ITINERARY_MAX_DAYS, PaginationDto } from '../../common';
import {
  HOTEL_SEARCH_MAX_GUESTS,
  HOTEL_SEARCH_MAX_ROOMS,
} from '../../hotels/hotels.constants';

/**
 * Query of GET /api/itineraries/:id/hotels (ITN-25). The city and the dates are NOT part of it: they come from the
 * city group the user picks, so there is nothing to type wrong and nothing that could disagree with the itinerary.
 * The limits for guests and rooms are the ones of the hotel search (HTL-11), imported so the two cannot drift apart.
 */
export class GroupHotelsQueryDto extends PaginationDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: ITINERARY_MAX_DAYS,
    description:
      'Picks the city group: the day number where it starts (`fromDayNumber` of an entry of `cityGroups` on GET /api/itineraries/:id).',
  })
  @Type(() => Number)
  @IsInt({ message: 'fromDayNumber must be a whole number' })
  @Min(1, { message: 'fromDayNumber must be at least 1' })
  @Max(ITINERARY_MAX_DAYS, {
    message: `fromDayNumber must be at most ${ITINERARY_MAX_DAYS}`,
  })
  fromDayNumber: number;

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: HOTEL_SEARCH_MAX_GUESTS,
    description: 'Total number of guests.',
  })
  @Type(() => Number)
  @IsInt({ message: 'guests must be a whole number' })
  @Min(1, { message: 'guests must be at least 1' })
  @Max(HOTEL_SEARCH_MAX_GUESTS, {
    message: `guests must be at most ${HOTEL_SEARCH_MAX_GUESTS}`,
  })
  guests: number;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    maximum: HOTEL_SEARCH_MAX_ROOMS,
    default: 1,
    description: 'Number of rooms. Defaults to 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'rooms must be a whole number' })
  @Min(1, { message: 'rooms must be at least 1' })
  @Max(HOTEL_SEARCH_MAX_ROOMS, {
    message: `rooms must be at most ${HOTEL_SEARCH_MAX_ROOMS}`,
  })
  rooms?: number;
}
