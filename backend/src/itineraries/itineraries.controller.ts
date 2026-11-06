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
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import { ItineraryResponseDto } from './dto/itinerary-response.dto';
import { ItineraryRowDto } from './dto/itinerary-row.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { ItinerariesService } from './itineraries.service';

// Itineraries belong to registered users (ITN-01), so every route needs the USER role.
// Ownership of a given itinerary, and who may read a public one (ITN-20), is checked in the service.
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
  constructor(private readonly itineraries: ItinerariesService) {}

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
  @ApiOperation({
    summary:
      "Open one of my itineraries (ITN-03), or another user's public one, read-only (ITN-20)",
  })
  @ApiOkResponse({ type: ItineraryResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      "No such itinerary, or someone else's that is private, hidden by an admin, or whose author is not active",
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
  ) {
    return this.itineraries.findOne(user, params.id);
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
}
