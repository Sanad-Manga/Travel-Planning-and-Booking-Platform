import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  Role,
  Roles,
} from '../common';
import { TransportCostIdParamDto } from './dto/transport-cost-id-param.dto';
import { TransportCostDto } from './dto/transport-cost.dto';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto';
import { TransportCostsService } from './transport-costs.service';

// Transport costs belong to the owner of the itinerary (ITN-16), so every route needs the USER role. Adding one is
// POST /api/itineraries/:id/transport-costs, in ItinerariesController. Ownership is checked in the service.
@ApiTags('transport-costs')
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
@Controller('transport-costs')
export class TransportCostsController {
  constructor(private readonly transportCosts: TransportCostsService) {}

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit one of my transport cost entries: mode, cities, amount, currency and/or day - ITN-16',
  })
  @ApiOkResponse({ type: TransportCostDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, a mode that is not allowed, an unknown city, an unsupported currency, a negative or fractional amount, a day that is not a day of the itinerary, an unknown field, or an empty body',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such entry (or it belongs to someone else)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: TransportCostIdParamDto,
    @Body() dto: UpdateTransportCostDto,
  ) {
    return this.transportCosts.update(user, params.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of my transport cost entries - ITN-16' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'id is not a valid id',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'No such entry (or it belongs to someone else)',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: TransportCostIdParamDto,
  ) {
    return this.transportCosts.remove(user, params.id);
  }
}
