import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  PaginationDto,
  Role,
  Roles,
} from '../common';
import { HotelReservationsPageDto } from './dto/hotel-reservation-list.dto';
import { HotelBookingsService } from './hotel-bookings.service';

/**
 * HTL-22: a hotel moderator reads the reservations of their own hotel. The route lives in the Hotels module next to
 * the other `/api/hotels` routes; it is kept in this Hotels B controller so the hotel profile/rooms controller
 * (HTL-01/HTL-02) is not touched. Read-only: there is deliberately no write route here.
 */
@ApiTags('hotels')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
@Controller('hotels')
export class HotelReservationsController {
  constructor(private readonly bookings: HotelBookingsService) {}

  @Get(':id/reservations')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: 'List reservations for my hotel (HTL-22)',
    description:
      'Read-only, newest first. A hotel moderator may only list the reservations of their own hotel: another, ' +
      'unknown or malformed hotel id answers 403. Each row shows the guest, the stay dates and the status; ' +
      'the booking reference is null while the reservation is still a pending hold. Paginated with the shared ' +
      'page/limit contract (default 10, maximum 50).',
  })
  @ApiOkResponse({ type: HotelReservationsPageDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid page or limit' })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: "Not a hotel moderator, or not the moderator's own hotel",
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() pagination: PaginationDto,
  ): Promise<HotelReservationsPageDto> {
    return this.bookings.listForHotel(id, user, pagination);
  }
}
