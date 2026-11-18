import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto, Public } from '../common';
import { HotelDetailsQueryDto } from './dto/hotel-details-query.dto';
import { HotelDetailsResponseDto } from './dto/hotel-details-response.dto';
import { HotelDetailsService } from './hotel-details.service';

/**
 * Registered right after HotelSearchController in HotelsModule: `GET /hotels/:id` must come after the fixed
 * `GET /hotels/search`, or `search` would be read as a hotel id. (`/:id/rooms/available` has more segments, so it can
 * never match `:id`.)
 */
@ApiTags('hotels')
@Controller('hotels')
export class HotelDetailsController {
  constructor(private readonly details: HotelDetailsService) {}

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Hotel details page (public, no login) - HTL-02',
    description:
      'Returns the profile (name, address, description, photos, stars, amenities), the check-in and check-out times and cancellation tiers (`policies`), the average rating and visible reviews. Send checkIn and checkOut (YYYY-MM-DD, both or neither) to also get the rooms free for every night of the stay in `rooms` (the HTL-15 list, paged by page/limit); without dates `rooms` is null. Only an active hotel is shown.',
  })
  @ApiParam({ name: 'id', example: '6730a1f2c3d4e5f607182930', description: 'Hotel id' })
  @ApiOkResponse({ type: HotelDetailsResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid query: only one of checkIn/checkOut, impossible date, checkOut not after checkIn, checkIn in the past, bad page/limit, unknown query field (field-level details)',
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'The hotel does not exist (or the id is malformed) or is not active' })
  get(@Param('id') id: string, @Query() query: HotelDetailsQueryDto): Promise<HotelDetailsResponseDto> {
    return this.details.getDetails(id, query);
  }
}
