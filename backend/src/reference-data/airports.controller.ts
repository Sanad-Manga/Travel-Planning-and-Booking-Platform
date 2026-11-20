import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiInternalServerErrorResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  ErrorResponseDto,
  PaginatedResponse,
  PaginationDto,
  Public,
} from '../common';
import { AirportResponseDto } from './dto/airport-response.dto';
import { ReferenceDataService } from './reference-data.service';

@ApiTags('airports')
@Controller('airports')
export class AirportsController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Public()
  @Get()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'List predefined airports with city, country and IANA time zone',
    description:
      'Public endpoint; no authentication cookie is required. Ordered by official IATA code. Airport data is managed exclusively through reference-data seeding.',
    security: [],
  })
  @ApiPaginatedResponse(AirportResponseDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid pagination or unsupported query parameter.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDto,
    description: 'Database failure or incomplete city/country reference data.',
  })
  list(
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponse<AirportResponseDto>> {
    return this.referenceData.listAirports(pagination);
  }
}
