import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  ErrorResponseDto,
  PaginationDto,
  Public,
} from '../common';
import { PublicItineraryRowDto } from './dto/public-itinerary-row.dto';
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
      'Public itineraries, most recently updated first (page size 10 by default); open to guests - ITN-20',
  })
  @ApiPaginatedResponse(PublicItineraryRowDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid page or limit',
  })
  search(@Query() query: PaginationDto) {
    return this.itineraries.searchPublic(query);
  }
}
