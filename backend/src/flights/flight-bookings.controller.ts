import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
