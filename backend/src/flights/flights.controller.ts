import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightResponseDto } from './dto/flight-response.dto';
import { FlightsService } from './flights.service';

@ApiTags('flights')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Post()
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Create a flight for your own airline - FLT-03',
    description:
      'Send departure and arrival in the LOCAL time of each airport (no offset). They are converted with the airport time zone and stored in UTC. The response returns UTC times plus the IANA zones.',
  })
  @ApiCreatedResponse({ type: FlightResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid input, unknown airport, same departure and arrival airport, arrival not after departure, or departure in the past (field-level details)',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description:
      'Caller is not an airline moderator, or the airline is deactivated',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'This airline already has this flight number on that departure date',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFlightDto) {
    return this.flights.create(user, dto);
  }
}
