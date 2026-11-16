import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
import { ApiPaginatedResponse, AuthenticatedUser, CurrentUser, ErrorResponseDto, PaginatedResponse, Role, Roles } from '../common';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingDetailsDto } from './dto/hotel-booking-details.dto';
import { HotelBookingIdParamDto } from './dto/hotel-booking-id-param.dto';
import { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { HotelBookingSummaryDto } from './dto/hotel-booking-summary.dto';
import { MyHotelBookingsQueryDto } from './dto/my-hotel-bookings-query.dto';
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

  @Get()
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'My hotel reservations: Upcoming / Past / Cancelled (HTL-20)',
    description:
      "The logged-in traveler's own reservations, one page at a time. Every row says which group it is in. " +
      'Send `group` to see one group: UPCOMING (confirmed stays that are not over, and reservations still waiting for payment, ' +
      'soonest check-in first), PAST (completed stays and confirmed stays whose check-out day is today or earlier, latest first) ' +
      'or CANCELLED (cancelled and expired reservations and holds that ran out, most recent first). Without `group` everything is listed, newest first. ' +
      'A reservation is in exactly one group. Dates are UTC.',
  })
  @ApiPaginatedResponse(HotelBookingSummaryDto)
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Unknown group, or page or limit out of range' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Only a registered traveler has hotel reservations' })
  findMine(@CurrentUser() user: AuthenticatedUser, @Query() query: MyHotelBookingsQueryDto): Promise<PaginatedResponse<HotelBookingSummaryDto>> {
    return this.bookings.findMine(user, query);
  }

  @Get(':id')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'One of my hotel reservations in full (HTL-20)',
    description:
      'Reference, hotel, every room with the price captured at booking time, dates, guests, total, status and group, ' +
      "and the refund of a cancelled reservation (`refund`, null while none is recorded). Owner only: someone else's reservation answers 404, like an unknown id.",
  })
  @ApiOkResponse({ type: HotelBookingDetailsDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'The id is not a valid id' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Only a registered traveler has hotel reservations' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'No such reservation of yours' })
  findMineById(@CurrentUser() user: AuthenticatedUser, @Param() params: HotelBookingIdParamDto): Promise<HotelBookingDetailsDto> {
    return this.bookings.findMineById(user, params.id);
  }
}
