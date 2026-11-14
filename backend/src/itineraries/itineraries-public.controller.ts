import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPaginatedResponse, ErrorResponseDto, Public } from '../common';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import { PublicItineraryRowDto } from './dto/public-itinerary-row.dto';
import { PublicItineraryDto } from './dto/public-itinerary.dto';
import { PublicSearchQueryDto } from './dto/public-search-query.dto';
import { ItinerariesService } from './itineraries.service';

/**
 * Shared, read-only itinerary routes under /api/itineraries/public. Guests may browse public itineraries
 * (project description, section 4), so there is no login or role here; what is shown is decided in the
 * service. This controller is registered BEFORE ItinerariesController, so a static path such as
 * /public/:id (ITN-21) is matched here and never taken for an itinerary id.
 */
@ApiTags('itineraries')
@Public()
@Controller('itineraries/public')
export class ItinerariesPublicController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Get('search')
  @ApiOperation({
    summary:
      'Search public itineraries by keyword (title, country, city), duration (minDays, maxDays), country and city; most recently updated first, page size 10 by default; open to guests - ITN-20, ITN-21',
  })
  @ApiPaginatedResponse(PublicItineraryRowDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid page or limit, a keyword that is too long, minDays or maxDays outside 1 to 60 or not whole numbers, minDays above maxDays, a malformed country code, or an unknown query field',
  })
  search(@Query() query: PublicSearchQueryDto) {
    return this.itineraries.searchPublic(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Open one public itinerary read-only: author, days, activities and budget totals; open to guests - ITN-21',
  })
  @ApiOkResponse({ type: PublicItineraryDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'No such itinerary, or it is private, hidden by an admin, or its author is not active',
  })
  findOne(@Param() params: ItineraryIdParamDto) {
    return this.itineraries.findPublic(params.id);
  }
}
