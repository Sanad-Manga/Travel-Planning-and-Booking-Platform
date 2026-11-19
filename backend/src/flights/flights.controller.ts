import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
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
import { FlightIdParamDto } from './dto/cabin-params.dto';
import {
  CancelFlightDto,
  FlightCancellationResponseDto,
} from './dto/cancel-flight.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { FlightCancellationService } from './flight-cancellation.service';
import { FlightEditService } from './flight-edit.service';
import { FlightsService } from './flights.service';

@ApiTags('flights')
@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flights: FlightsService,
    private readonly edit: FlightEditService,
    private readonly cancellation: FlightCancellationService,
  ) {}

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

  @Patch(':id')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
  @ApiOperation({
    summary: 'Edit the times or airports of your own SCHEDULED flight - FLT-05',
    description:
      'Send any of departureLocalTime, arrivalLocalTime (LOCAL time of each airport, no offset), departureAirport, arrivalAirport. The airports can only change while the flight has no active booking. A change of time notifies every passenger with a CONFIRMED booking (FLIGHT_SCHEDULE_CHANGED). Cabin prices and seat counts are edited with PATCH /api/flights/:id/cabins/:cabinId; prices never change existing bookings.',
  })
  @ApiOkResponse({ type: FlightResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Empty body, unknown field (including flightNumber), unknown airport, same departure and arrival airport, arrival not after departure, or departure in the past (field-level details)',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description:
      'Caller is not an airline moderator, or the flight belongs to another airline',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Flight not found',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The flight is not SCHEDULED (cancelled or departed), the airports cannot change because the flight is booked, or the flight number is already used on the new departure date',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: FlightIdParamDto,
    @Body() dto: UpdateFlightDto,
  ) {
    return this.edit.update(user, params.id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
  @ApiOperation({
    summary:
      'Cancel your own SCHEDULED flight: bookings cancelled and refunded in full - FLT-06',
    description:
      'Send { "confirm": true }. The flight becomes CANCELLED (it leaves search and cannot be booked), every unpaid hold is released, every CONFIRMED booking on it (a round trip is cancelled as a whole) becomes CANCELLED with a 100% refund through PAY-03, and each passenger is notified (BOOKING_CANCELLED). If something could not finish (for example a refund the payment provider refused), the flight stays CANCELLED, `complete` is false and `pending` lists those bookings; send the same request again to retry just them. Nobody is refunded twice.',
  })
  @ApiOkResponse({ type: FlightCancellationResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'confirm is missing, not a boolean, or not true',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description:
      'Caller is not an airline moderator, or the flight belongs to another airline',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Flight not found',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'The flight has already departed and cannot be cancelled',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: FlightIdParamDto,
    // The body is validated only: it is a required confirmation.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _dto: CancelFlightDto,
  ) {
    return this.cancellation.cancel(user, params.id);
  }
}
