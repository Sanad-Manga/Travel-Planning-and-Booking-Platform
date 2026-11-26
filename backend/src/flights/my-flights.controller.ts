import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  Role,
  Roles,
} from '../common';
import { FlightResponseDto } from './dto/flight-response.dto';
import { MyFlightsQueryDto } from './dto/my-flights-query.dto';
import { MyFlightsService } from './my-flights.service';

@ApiTags('flights')
@Controller('flights')
export class MyFlightsController {
  constructor(private readonly myFlights: MyFlightsService) {}

  @Get('mine')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'List the flights of your own airline - FLT-29, FLT-30',
    description:
      'Paginated, latest departure first, in every status (SCHEDULED, CANCELLED, DEPARTED); `status` filters. A SCHEDULED flight whose departure time has passed is reported and filtered as DEPARTED. Use a flight id from here with `GET /flights/{id}/bookings`.',
  })
  @ApiPaginatedResponse(FlightResponseDto)
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid page, limit or status',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Caller is not an airline moderator',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyFlightsQueryDto,
  ) {
    return this.myFlights.list(user, query);
  }
}
