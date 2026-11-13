import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
  Public,
  Role,
  Roles,
} from '../common';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightDetailsResponseDto } from './dto/flight-details-response.dto';
import { FlightResponseDto } from './dto/flight-response.dto';
import { FlightsService } from './flights.service';

@ApiTags('flights')
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Get(':id')
  @Public()
  @ApiOperation({
    summary:
      'Get public flight details, cabins and cancellation policy - FLT-17',
    description:
      'Shows local times with their UTC offsets, duration, every cabin including sold-out cabins, available seats, baggage allowance and the airline cancellation tiers.',
  })
  @ApiOkResponse({ type: FlightDetailsResponseDto })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Flight not found or its airline is inactive',
  })
  getDetails(@Param('id') id: string) {
    return this.flights.getDetails(id);
  }

  @Post()
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
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
