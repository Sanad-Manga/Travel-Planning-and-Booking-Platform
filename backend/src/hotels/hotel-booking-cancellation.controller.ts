import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, ErrorResponseDto, Role, Roles } from '../common';
import { HotelCancellationPreviewDto, HotelCancellationResultDto } from './dto/hotel-cancellation.dto';
import { HotelBookingCancellationService } from './hotel-booking-cancellation.service';

/** HTL-21: cancel a whole hotel reservation with a tier-based refund (owner only). */
@ApiTags('hotel-bookings')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Not logged in' })
@Controller('hotel-bookings')
export class HotelBookingCancellationController {
  constructor(private readonly cancellation: HotelBookingCancellationService) {}

  @Get(':id/cancel-preview')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Refund preview before cancelling a hotel reservation (HTL-21)',
    description:
      'Shows what cancelling the reservation would refund right now: the hotel cancellation tiers (HTL-10) applied to the full total, ' +
      'counted from now to the check-in moment (UTC, the check-in date at the hotel check-in time). Nothing is changed. ' +
      'Only a CONFIRMED reservation before check-in can be cancelled.',
  })
  @ApiOkResponse({ type: HotelCancellationPreviewDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Only a registered traveler can cancel a hotel reservation' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: "No such reservation of yours (someone else's reservation answers 404 too)" })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The reservation is not CONFIRMED, or its check-in time has passed' })
  preview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<HotelCancellationPreviewDto> {
    return this.cancellation.preview(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Cancel a whole hotel reservation with a tier-based refund (HTL-21)',
    description:
      'Cancels the traveler’s own CONFIRMED reservation as a whole, before check-in (no partial cancellation). The reservation becomes CANCELLED and ' +
      'all its rooms are free again for those dates. The refund is the hotel tier percentage of the full total (the same amount as the preview) and is ' +
      'created through the payments refund service; when no tier applies nothing is refunded and `refund` is null.',
  })
  @ApiOkResponse({ type: HotelCancellationResultDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'Only a registered traveler can cancel a hotel reservation' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: "No such reservation of yours (someone else's reservation answers 404 too)" })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'The reservation is not CONFIRMED, its check-in time has passed, or it was cancelled by another request' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<HotelCancellationResultDto> {
    return this.cancellation.cancel(user, id);
  }
}
