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
  Role,
  Roles,
} from '../common';
import { FlightBookingResponseDto } from './dto/flight-booking-response.dto';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { FlightBookingSummaryResponseDto } from './dto/flight-booking-summary-response.dto';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';

@ApiTags('flight-bookings')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Not logged in',
})
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly bookings: FlightBookingsService) {}

  @Get(':id')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Get the pending flight booking summary - FLT-21',
    description:
      'Returns flight, passenger, baggage and payable-total details for the booking owner. ' +
      'The total is read from the same getPayable amount used by Payments.',
  })
  @ApiOkResponse({ type: FlightBookingSummaryResponseDto })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only travelers (role USER) can view a flight booking summary',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'The booking is unknown or belongs to another traveler',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'A summary is available only while the booking is pending payment',
  })
  getSummary(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookings.getSummary(user, id);
  }

  @Post()
  @Roles(Role.USER)
  @ApiOperation({
    summary:
      'Create a flight booking with passenger and baggage details - FLT-19',
    description:
      "Derives adult/child/infant types from each passenger's date of birth on the flight's local departure date, " +
      'then atomically holds the required seats and creates a PENDING_PAYMENT booking. Extra-bag fees are included in totalCents.',
  })
  @ApiCreatedResponse({ type: FlightBookingResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Missing or invalid passenger details, invalid passenger counts, or baggage limits exceeded',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only travelers (role USER) can book flights',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Unknown flight, or the flight has no such cabin',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'Not enough seats left, or the flight is cancelled, departed or its airline is deactivated',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFlightBookingDto,
  ) {
    return this.bookings.create(user, dto);
  }

  @Post('hold')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Hold seats and create a PENDING_PAYMENT booking - FLT-22',
    description:
      'Reserves the requested seats in one atomic step (only if enough remain) and creates a booking waiting for payment. ' +
      'The seats are held for HOLD_MINUTES (10); if the booking is not paid by holdExpiresAt it becomes EXPIRED and the seats are released. ' +
      'Seats needed = adults + children; infants take no seat and pay 10% of the fare.',
  })
  @ApiCreatedResponse({ type: FlightBookingResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid input, no adult, or more infants than adults (field-level details)',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only travelers (role USER) can book flights',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Unknown flight, or the flight has no such cabin',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'Not enough seats left, or the flight is cancelled, departed or its airline is deactivated',
  })
  hold(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: HoldFlightBookingDto,
  ) {
    return this.bookings.hold(user, dto);
  }
}
