import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  ErrorResponseDto,
  PaginatedResponse,
  PaginationDto,
  Public,
} from '../common';
import {
  CitiesQueryDto,
  CityResponseDto,
  CountryResponseDto,
  CurrencyResponseDto,
} from './dto/reference-lookups.dto';
import { ReferenceDataService } from './reference-data.service';

const BAD_QUERY = {
  type: ErrorResponseDto,
  description: 'Invalid pagination or unsupported query parameter.',
};

/** GEN-12: public, read-only lookups. The data is managed only through reference-data seeding. */
@ApiTags('reference-data')
@Controller('countries')
export class CountriesController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'List countries with their official currency - GEN-12',
    description:
      'Public endpoint; no authentication cookie is required. Ordered by official country code.',
    security: [],
  })
  @ApiPaginatedResponse(CountryResponseDto)
  @ApiBadRequestResponse(BAD_QUERY)
  list(
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponse<CountryResponseDto>> {
    return this.referenceData.listCountriesPage(pagination);
  }
}

@ApiTags('reference-data')
@Controller('cities')
export class CitiesController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'List cities, optionally of one country - GEN-12',
    description:
      'Public endpoint; no authentication cookie is required. Ordered by official city id. `countryCode` filters by country.',
    security: [],
  })
  @ApiPaginatedResponse(CityResponseDto)
  @ApiBadRequestResponse(BAD_QUERY)
  list(
    @Query() query: CitiesQueryDto,
  ): Promise<PaginatedResponse<CityResponseDto>> {
    return this.referenceData.listCitiesPage(query, query.countryCode);
  }
}

@ApiTags('reference-data')
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'List currencies - GEN-12',
    description:
      'Public endpoint; no authentication cookie is required. Ordered by official currency code.',
    security: [],
  })
  @ApiPaginatedResponse(CurrencyResponseDto)
  @ApiBadRequestResponse(BAD_QUERY)
  list(
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponse<CurrencyResponseDto>> {
    return this.referenceData.listCurrenciesPage(pagination);
  }
}
