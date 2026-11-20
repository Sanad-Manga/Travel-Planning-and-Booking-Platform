import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ErrorResponseDto, Public } from '../common';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import {
  FlightRoundTripSearchResponseDto,
  FlightSearchPageDto,
} from './dto/flight-search-response.dto';
import { FlightSearchService } from './flight-search.service';

@ApiTags('flights')
@ApiExtraModels(FlightSearchPageDto, FlightRoundTripSearchResponseDto)
@Controller('flights')
export class FlightSearchController {
  constructor(private readonly search: FlightSearchService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'One-way or round-trip flight search - FLT-11, FLT-12',
    description:
      'Without returnDate, returns one-way results. With returnDate, returns separate outbound and reverse-route result pages. Flights must be scheduled, depart in the requested local date, and have enough seats in at least one requested cabin. Optional cabinClass narrows both pages. Price range and sorting apply independently to each page.',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(FlightSearchPageDto) },
        { $ref: getSchemaPath(FlightRoundTripSearchResponseDto) },
      ],
    },
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid query, impossible date, unknown airport, identical airports, or minPrice greater than maxPrice (field-level details)',
  })
  find(@Query() query: FlightSearchQueryDto) {
    return this.search.search(query);
  }
}