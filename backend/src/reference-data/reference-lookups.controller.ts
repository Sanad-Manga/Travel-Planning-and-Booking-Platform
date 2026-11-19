import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  ErrorResponseDto,
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

@ApiTags('reference-data')
@ApiBadRequestResponse({
  type: ErrorResponseDto,
  description: 'Invalid or unsupported query parameter.',
})
@ApiInternalServerErrorResponse({
  type: ErrorResponseDto,
  description: 'Reference data could not be retrieved.',
})
@Public()
@Controller()
export class ReferenceLookupsController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Get('countries')
  @ApiOperation({
    summary: 'List seeded countries by country code',
    security: [],
  })
  @ApiPaginatedResponse(CountryResponseDto)
  listCountries(@Query() pagination: PaginationDto) {
    return this.referenceData.listCountryPage(pagination);
  }

  @Get('cities')
  @ApiOperation({
    summary: 'List seeded cities by city ID, optionally within a country',
    security: [],
  })
  @ApiPaginatedResponse(CityResponseDto)
  listCities(@Query() query: CitiesQueryDto) {
    return this.referenceData.listCityPage(query, query.countryCode);
  }

  @Get('currencies')
  @ApiOperation({
    summary: 'List supported seeded currencies by code',
    security: [],
  })
  @ApiPaginatedResponse(CurrencyResponseDto)
  listCurrencies(@Query() pagination: PaginationDto) {
    return this.referenceData.listCurrencyPage(pagination);
  }
}
