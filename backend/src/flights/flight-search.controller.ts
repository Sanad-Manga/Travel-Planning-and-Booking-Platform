import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto, Public } from '../common';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import { FlightSearchPageDto } from './dto/flight-search-response.dto';
import { FlightSearchService } from './flight-search.service';

@ApiTags('flights')
@Controller('flights')
export class FlightSearchController {
  constructor(private readonly search: FlightSearchService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'One-way flight search - FLT-11',
    description:
      'Scheduled flights of active airlines on the local departure date with enough seats (total - booked - held). Each result lists the cabins that can seat all passengers. Optional: minPrice and maxPrice (inclusive, in cents, applied per cabin fare) and sort by price (cheapest matching cabin), duration or departureTime with order asc or desc. No match returns an empty list.',
  })
  @ApiOkResponse({ type: FlightSearchPageDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid query, impossible date, unknown airport, identical airports, or minPrice greater than maxPrice (field-level details)',
  })
  find(@Query() query: FlightSearchQueryDto) {
    return this.search.search(query);
  }
}