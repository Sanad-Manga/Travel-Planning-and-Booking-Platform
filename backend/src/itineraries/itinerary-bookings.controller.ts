import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto } from '../common';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import { ItineraryBookingDto, LinkBookingDto } from './dto/link-booking.dto';
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
}
