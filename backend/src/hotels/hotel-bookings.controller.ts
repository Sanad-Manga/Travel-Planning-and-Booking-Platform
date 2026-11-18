import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
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
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { CreateHotelReviewDto } from './dto/create-hotel-review.dto';
import { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelReviewsService } from './hotel-reviews.service';
import { HotelReviewItemDto } from './dto/hotel-details-response.dto';

@ApiTags('hotel-bookings')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(
    private readonly bookings: HotelBookingsService,
    private readonly reviews: HotelReviewsService,
  ) {}

  @Get(':id')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Get an owned hotel reservation and its payment confirmation (HTL-17)',
    description: 'Returns the authenticated traveler’s hotel reservation, including CONFIRMED status and bookingReference after successful payment.',
  })
  @ApiOkResponse({ type: HotelBookingResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Hotel booking not found' })
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<HotelBookingResponseDto> {
    const booking = await this.bookings.getForUser(id, user.userId);
    if (!booking) throw new NotFoundException('Hotel booking not found');
    return booking;
  }

  @Post()
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Create a hotel reservation with an all-or-nothing room hold (HTL-18)',
    description:
      'Send check-in/check-out dates and each selected room with its adult/child counts. All rooms must be in the same hotel. ' +
      'The API re-checks room availability, blocked ranges, and overlapping reservations in one MongoDB transaction. It creates one PENDING_PAYMENT reservation holding every selected room for HOLD_MINUTES; if any room conflicts, the request returns 409 and holds none.',
  })
  @ApiCreatedResponse({ type: HotelBookingResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid dates, no adult in the reservation, invalid room selection, or a room exceeds its maximum occupancy' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Only a registered traveler can create a hotel reservation' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'A selected hotel is not active' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'A selected room is unavailable, blocked, overlaps a confirmed reservation, or has an unexpired hold' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateHotelBookingDto,
  ): Promise<HotelBookingResponseDto> {
    return this.bookings.create(user, dto);
  }

  @Post(':id/review')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Review a completed hotel reservation (HTL-23)',
    description:
      'The reservation owner may submit one 1-5 star rating and an optional written review of at most 1000 characters after check-out.',
  })
  @ApiCreatedResponse({ type: HotelReviewItemDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Rating or review text is invalid' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Only a traveler can submit a review' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Hotel booking not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The stay is not completed or already has a review' })
  createReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateHotelReviewDto,
  ): Promise<HotelReviewItemDto> {
    return this.reviews.createForBooking(id, user, dto);
  }
}
