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
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { HotelBookingsService } from './hotel-bookings.service';

@ApiTags('hotel-bookings')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly bookings: HotelBookingsService) {}

  @Post()
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Create a hotel reservation and hold its rooms for payment (HTL-16)',
    description:
      'Send check-in/check-out dates and each selected room with its adult/child counts. All rooms must be in the same hotel. ' +
      'The API re-checks date availability and existing reservations in one transaction, snapshots the room prices, and creates a PENDING_PAYMENT reservation held for HOLD_MINUTES.',
  })
  @ApiCreatedResponse({ type: HotelBookingResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid dates, no adult in the reservation, invalid room selection, or a room exceeds its maximum occupancy' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Only a registered traveler can create a hotel reservation' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'A selected hotel is not active' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'A selected room is unavailable, reserved, or held by another reservation' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHotelBookingDto,
  ): Promise<HotelBookingResponseDto> {
    return this.bookings.create(user, dto);
  }
}
