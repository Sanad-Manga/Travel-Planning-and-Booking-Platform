import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  AuthenticatedUser,
  CurrentUser,
} from '../common';
import { HotelSearchItemDto } from '../hotels/dto/hotel-search-response.dto';
import { GroupHotelsQueryDto } from './dto/group-hotels-query.dto';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import {
  ApiBadRequest,
  ApiNotFound,
  ITINERARY_NOT_FOUND,
  UserRoutes,
} from './itineraries.swagger';
import { ItineraryHotelsService } from './itinerary-hotels.service';

// ITN-25: the hotels that are free for one city group of the owner's itinerary.
@UserRoutes('itineraries')
@Controller('itineraries')
export class ItineraryHotelsController {
  constructor(private readonly hotels: ItineraryHotelsService) {}

  @Get(':id/hotels')
  @ApiOperation({
    summary:
      "Hotels that are free for one city group of my itinerary: check-in is the group's first day, check-out the day after its last day; pick the group with fromDayNumber and enter guests and rooms (reuses the hotel search, HTL-11) - ITN-25",
  })
  @ApiPaginatedResponse(HotelSearchItemDto)
  @ApiBadRequest(
    'Invalid id, page or limit; a missing or invalid fromDayNumber, guests or rooms; a fromDayNumber where no city group starts (the message lists the days where one does); a group that is already over; or an unknown query field',
  )
  @ApiNotFound(ITINERARY_NOT_FOUND)
  hotelsForGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Query() query: GroupHotelsQueryDto,
  ) {
    return this.hotels.hotelsForGroup(user, params.id, query);
  }
}
