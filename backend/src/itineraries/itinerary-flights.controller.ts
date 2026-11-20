import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../common';
import {
  FlightRoundTripSearchResponseDto,
  FlightSearchPageDto,
} from '../flights/dto/flight-search-response.dto';
import { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto';
import { ItineraryFlightsDto } from './dto/itinerary-flights-response.dto';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import {
  ApiBadRequest,
  ApiNotFound,
  ITINERARY_NOT_FOUND,
  UserRoutes,
} from './itineraries.swagger';
import { ItineraryFlightsService } from './itinerary-flights.service';

// ITN-26: flights to the city the owner's itinerary starts in.
@UserRoutes('itineraries')
@ApiExtraModels(FlightSearchPageDto, FlightRoundTripSearchResponseDto)
@Controller('itineraries')
export class ItineraryFlightsController {
  constructor(private readonly flights: ItineraryFlightsService) {}

  @Get(':id/flights')
  @ApiOperation({
    summary:
      "Flights from an airport I choose to the city of my itinerary's first day: one-way or round trip, every airport of that city; the outbound date defaults to the start date and the return date to the last day's date (reuses the flight search, FLT-11 and FLT-12) - ITN-26",
  })
  @ApiOkResponse({ type: ItineraryFlightsDto })
  @ApiBadRequest(
    'Invalid id, page, limit, origin airport, passengers or filter; an impossible date or a return date before the outbound date; a returnDate on a ONE_WAY search; an itinerary without days or whose first-day city has no airport (or only the origin airport); or an unknown query field',
  )
  @ApiNotFound(ITINERARY_NOT_FOUND)
  flightsForItinerary(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Query() query: ItineraryFlightsQueryDto,
  ) {
    return this.flights.flightsForItinerary(user, params.id, query);
  }
}
