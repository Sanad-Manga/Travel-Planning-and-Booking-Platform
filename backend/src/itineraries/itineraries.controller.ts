import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  PaginationDto,
  Role,
  Roles,
} from '../common';
import { CreateItineraryDayDto } from './dto/create-itinerary-day.dto';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import { TransportCostDto } from './dto/transport-cost.dto';
import { TransportCostsService } from './transport-costs.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ItineraryDayParamDto } from './dto/itinerary-day-param.dto';
import { ItineraryDayDto } from './dto/itinerary-day.dto';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import { ItineraryResponseDto } from './dto/itinerary-response.dto';
import { ItineraryRowDto } from './dto/itinerary-row.dto';
import { UpdateItineraryDayDto } from './dto/update-itinerary-day.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { ItinerariesService } from './itineraries.service';

// Itineraries belong to registered users (ITN-01), so every route needs the USER role.
// Ownership of a given itinerary is checked in the service. Public routes are in ItinerariesPublicController.
@ApiTags('itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@ApiForbiddenResponse({
  type: ErrorResponseDto,
  description: 'Caller is not a registered user (admin or moderator)',
})
@Roles(Role.USER)
@Controller('itineraries')
export class ItinerariesController {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly transportCosts: TransportCostsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create an itinerary (private by default) - ITN-01',
  })
  @ApiCreatedResponse({ type: ItineraryResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Missing or too long title, no country, an unknown country code, an invalid start date, or an unknown field',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateItineraryDto,
  ) {
    return this.itineraries.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'List my itineraries, most recently updated first (page size 10 by default) - ITN-03',
  })
  @ApiPaginatedResponse(ItineraryRowDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid page or limit',
  })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationDto,
  ) {
    return this.itineraries.listMine(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Open one of my itineraries - ITN-03' })
  @ApiOkResponse({ type: ItineraryResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such itinerary (or it belongs to someone else)',
  })
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
  ) {
    return this.itineraries.findMine(user, params.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit my itinerary: title, countries and/or start date (ITN-01), visibility PUBLIC or PRIVATE (ITN-20)',
  })
  @ApiOkResponse({ type: ItineraryResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, title, countries, start date or visibility, an unknown field, or an empty body',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such itinerary (or it belongs to someone else)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Body() dto: UpdateItineraryDto,
  ) {
    return this.itineraries.update(user, params.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete my itinerary (the client asks for confirmation first). Clones made by others stay - ITN-01',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such itinerary (or it belongs to someone else)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
  ) {
    return this.itineraries.remove(user, params.id);
  }

  @Post(':id/days')
  @ApiOperation({
    summary:
      'Add a day at the end of my itinerary: city and notes; number and date are derived (max 60 days) - ITN-05',
  })
  @ApiCreatedResponse({ type: ItineraryDayDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, missing or unknown city, notes too long, an unknown field, or the itinerary already has 60 days',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such itinerary (or it belongs to someone else)',
  })
  addDay(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Body() dto: CreateItineraryDayDto,
  ) {
    return this.itineraries.addDay(user, params.id, dto);
  }

  @Patch(':id/days/:dayId')
  @ApiOperation({
    summary: 'Edit a day of my itinerary: city and/or notes - ITN-05',
  })
  @ApiOkResponse({ type: ItineraryDayDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id or dayId, unknown city, notes too long, an unknown field, or an empty body',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'No such itinerary or day (or the itinerary belongs to someone else)',
  })
  updateDay(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryDayParamDto,
    @Body() dto: UpdateItineraryDayDto,
  ) {
    return this.itineraries.updateDay(user, params.id, params.dayId, dto);
  }

  @Post(':id/transport-costs')
  @ApiOperation({
    summary:
      'Add an intercity transport cost to my itinerary: mode, from and to city, amount in cents, currency and day - ITN-16',
  })
  @ApiCreatedResponse({ type: TransportCostDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, a missing field, a mode that is not allowed, an unknown city, an unsupported currency, a negative or fractional amount, a day that is not a day of this itinerary, or an unknown field',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such itinerary (or it belongs to someone else)',
  })
  addTransportCost(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Body() dto: CreateTransportCostDto,
  ) {
    return this.transportCosts.create(user, params.id, dto);
  }

  @Delete(':id/days/:dayId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete a day of my itinerary (the client asks for confirmation first). The other days are renumbered and re-dated by themselves - ITN-07',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id or dayId is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'No such itinerary or day (or the itinerary belongs to someone else)',
  })
  removeDay(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryDayParamDto,
  ) {
    return this.itineraries.removeDay(user, params.id, params.dayId);
  }
}
