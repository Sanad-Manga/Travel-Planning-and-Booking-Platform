import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto, Public } from '../common';
import { HotelSearchQueryDto } from './dto/hotel-search-query.dto';
import { HotelSearchPageDto } from './dto/hotel-search-response.dto';
import { HotelSearchService } from './hotel-search.service';

/**
 * Registered BEFORE HotelsController in HotelsModule and kept apart from it, so a later `GET /hotels/:id`
 * (HTL-12) can never capture `search` as an id.
 */
@ApiTags('hotels')
@Controller('hotels')
export class HotelSearchController {
  constructor(private readonly search: HotelSearchService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Search hotels by city or country, dates, guests and rooms, with price/rating filters (public) - HTL-11, HTL-12',
    description:
      'Send cityId OR countryCode, checkIn, checkOut (YYYY-MM-DD, checkOut after checkIn, checkIn not in the past), guests and optionally rooms (default 1). Returns ACTIVE hotels that have at least `rooms` rooms free for every night of the stay whose combined maximum occupancy covers the guests. ' +
      'HTL-12: optionally filter by an inclusive price per night in integer cents (minPrice/maxPrice, using the cheapest qualifying room or combination) and by a minimum average review rating (1-5, a hotel with no rating is excluded while minRating is set). Sort with sort=price|rating and order=asc|desc; price is the default and reproduces the original cheapest-first order, and unrated hotels are always last when sorting by rating. ' +
      'This only checks availability: nothing is held or booked. No match returns an empty list.',
  })
  @ApiOkResponse({ type: HotelSearchPageDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid query: neither or both of cityId/countryCode, unknown city or country, impossible date, checkOut not after checkIn, checkIn in the past, guests or rooms below 1, minPrice above maxPrice, minRating outside 1-5, non-integer price or an unknown sort/order value (field-level details)',
  })
  find(@Query() query: HotelSearchQueryDto): Promise<HotelSearchPageDto> {
    return this.search.search(query);
  }
}
