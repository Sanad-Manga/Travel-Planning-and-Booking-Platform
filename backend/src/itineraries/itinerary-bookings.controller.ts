import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  PaginationDto,
} from '../common';
import { ItineraryBookingLinkParamDto } from './dto/itinerary-booking-link-param.dto';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import {
  ItineraryBookingDto,
  ItineraryBookingListItemDto,
  LinkBookingDto,
} from './dto/link-booking.dto';
import { ItineraryBookingsService } from './itinerary-bookings.service';
import { ApiBadRequest, ApiNotFound, UserRoutes } from './itineraries.swagger';

// ITN-27: the owner links a confirmed flight or hotel booking to a day of their itinerary. Ownership of the itinerary
// and of the booking is checked in the service.
@UserRoutes('itineraries')
@Controller('itineraries')
export class ItineraryBookingsController {
  constructor(private readonly bookings: ItineraryBookingsService) {}

  @Post(':id/bookings')
  @ApiOperation({
    summary:
      'Link one of my confirmed flight or hotel bookings to a day of my itinerary; its amount feeds the budget - ITN-27',
    description:
      'Only my own CONFIRMED bookings can be linked, to a day of one of my itineraries, once per itinerary. ' +
      'The amount and currency are read from the booking. A hotel booking is counted under ACCOMMODATION and a flight booking under ' +
      'INTERCITY_TRANSPORT in the budget summary and the day totals (GET /api/itineraries/:id/budget-summary); a linked booking that is cancelled later stops counting. ' +
      'The public view and clones of the itinerary do not include linked bookings.',
  })
  @ApiCreatedResponse({ type: ItineraryBookingDto })
  @ApiBadRequest(
    'Invalid id, a missing or unknown bookingType, a bookingId or dayId that is not a valid id, or an unknown field',
  )
  @ApiNotFound(
    'No such itinerary or day of mine, or no such booking of mine of that type (someone else’s booking answers 404 too)',
  )
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The booking is not CONFIRMED, or it is already linked to this itinerary',
  })
  link(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Body() dto: LinkBookingDto,
  ) {
    return this.bookings.link(user, params.id, dto);
  }

  @Get(':id/bookings')
  @ApiOperation({
    summary:
      'List the bookings linked to my itinerary, with their status and whether they count in the budget - ITN-27',
    description:
      'The links of one of my itineraries, oldest first, one page at a time (page 1 and 10 per page by default, at most 50). ' +
      'Each has the status of its booking now and `counted`: only a CONFIRMED or COMPLETED booking counts in the budget, so a booking cancelled later is listed but not counted.',
  })
  @ApiPaginatedResponse(ItineraryBookingListItemDto)
  @ApiBadRequest('id is not a valid id, or page or limit is out of range')
  @ApiNotFound(
    'No such itinerary of mine (someone else’s itinerary answers 404 too)',
  )
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Query() query: PaginationDto,
  ) {
    return this.bookings.list(user, params.id, query);
  }

  @Delete(':id/bookings/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Unlink a booking from my itinerary: its amount leaves the budget - ITN-27',
    description:
      'Removes the link made by POST /api/itineraries/:id/bookings (the booking itself is not touched). The booking can be linked again afterwards.',
  })
  @ApiNoContentResponse({ description: 'Unlinked' })
  @ApiBadRequest('id or linkId is not a valid id')
  @ApiNotFound(
    'No such link on this itinerary of mine (someone else’s, an unknown, an already removed link, or one of another itinerary)',
  )
  unlink(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryBookingLinkParamDto,
  ) {
    return this.bookings.unlink(user, params.id, params.linkId);
  }
}
