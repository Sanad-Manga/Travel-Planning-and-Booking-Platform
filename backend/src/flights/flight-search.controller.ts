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
      'Scheduled flights of active airlines on the local departure date with enough seats (total - booked - held). Each result lists the cabins that can seat all passengers. No match returns an empty list.',
  })
  @ApiOkResponse({ type: FlightSearchPageDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid query, impossible date, unknown airport, or identical airports (field-level details)',
  })
  find(@Query() query: FlightSearchQueryDto) {
    return this.search.search(query);
  }
}