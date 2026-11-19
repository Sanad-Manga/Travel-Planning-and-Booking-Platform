import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
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
  FlightRosterBookingDto,
  FlightRosterQueryDto,
} from './dto/flight-roster.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { FlightEditService } from './flight-edit.service';
import { FlightRosterService } from './flight-roster.service';
import { FlightsService } from './flights.service';

@ApiTags('flights')
@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flights: FlightsService,
    private readonly edit: FlightEditService,
    private readonly roster: FlightRosterService,
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

  @Get(':id/bookings')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
  @ApiOperation({
    summary:
      'List the bookings of your own flight with seats remaining - FLT-29',
    description:
      'Paginated bookings (newest first) with booking reference, passenger names, cabin and seats on this flight, and status (CONFIRMED, CANCELLED or COMPLETED; unpaid holds are not listed). `status` filters. Each row carries `cabinSeatsRemaining`, the seats still free in its cabin. A round-trip booking appears under both of its flights. Passport/ID numbers are never returned.',
  })
  @ApiPaginatedResponse(FlightRosterBookingDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid id, page, limit or status',
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
  bookings(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: FlightIdParamDto,
    @Query() query: FlightRosterQueryDto,
  ) {
    return this.roster.list(user, params.id, query);
  }

  @Get(':id/passengers/export')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiProduces('text/csv')
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Not logged in',
  })
  @ApiOperation({
    summary: 'Download the passenger list of your own flight as CSV - FLT-29',
    description:
      'text/csv with a header row (bookingReference, bookingStatus, passengerName, passengerType, cabinClass, seats), one row per passenger of every CONFIRMED or COMPLETED booking. Values are quoted where needed, and a value starting with = + - or @ is prefixed so a spreadsheet cannot run it as a formula. Passport/ID numbers and dates of birth are not exported.',
  })
  @ApiOkResponse({
    description: 'The CSV file',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid id',
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
  async exportPassengers(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: FlightIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const file = await this.roster.exportPassengers(user, params.id);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
    });
    return file.content;
  }
}
