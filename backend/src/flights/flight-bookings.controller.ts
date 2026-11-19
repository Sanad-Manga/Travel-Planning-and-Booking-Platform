import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
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
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import {
  AuthenticatedUser,
  CurrentUser,
  ErrorResponseDto,
  ApiPaginatedResponse,
  Role,
  Roles,
} from '../common';
import { FlightBookingResponseDto } from './dto/flight-booking-response.dto';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { CancelFlightBookingDto } from './dto/cancel-flight-booking.dto';
import { ChangeFlightBookingDto } from './dto/change-flight-booking.dto';
import { FlightBookingCancelResponseDto } from './dto/flight-booking-cancel-response.dto';
import { FlightBookingListRowDto } from './dto/flight-booking-list-row.dto';
import { FlightBookingSummaryResponseDto } from './dto/flight-booking-summary-response.dto';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { MyFlightBookingsQueryDto } from './dto/my-flight-bookings-query.dto';
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

  @Get()
  @Roles(Role.USER)
  @ApiOperation({
    summary: "List the traveler's own flight bookings - FLT-25",
    description:
      "Returns only the authenticated traveler's flight bookings, newest first, as the shared paginated envelope " +
      '`{ items, page, limit, total, totalPages }`: `page` defaults to 1 and `limit` to 10 (maximum 50). ' +
      'Each item carries the booking reference (absent on historical bookings confirmed before FLT-23), its `group`, status, cabin, ' +
      'the outbound flight and every one-way or round-trip segment with flight details, passengers and the booking total. ' +
      "Grouping: a CANCELLED booking is always CANCELLED; every other status is UPCOMING when the outbound segment's UTC " +
      'departureAt is after now, otherwise PAST. A round trip is grouped by its outbound segment and still returns both segments. ' +
      "Use the optional `group` query parameter to request one group. Another traveler's bookings are never returned, and " +
      'passport/identity-document numbers, payment references, Stripe ids and payment credentials are never included.',
  })
  @ApiPaginatedResponse(FlightBookingListRowDto)
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid pagination (page < 1, limit outside 1-50) or an unknown group value',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only travelers (role USER) can list their flight bookings',
  })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyFlightBookingsQueryDto,
  ) {
    return this.bookings.listMine(user, query);
  }

  @Get(':id/e-ticket')
  @Roles(Role.USER)
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Download the confirmed flight booking e-ticket PDF - FLT-23',
    description:
      "Generates a PDF e-ticket for the booking owner only. The booking must be CONFIRMED and have its unique booking reference. " +
      'Another traveler\'s booking and an unknown id both answer 404, so ids cannot be probed; a pending, expired or cancelled booking answers 409. ' +
      'The PDF contains the reference, passenger names/types and every booked segment; it never contains passport/identity-document numbers or payment data, and no file is stored on the server.',
  })
  @ApiOkResponse({
    description:
      'The e-ticket as a downloadable PDF attachment; the filename contains the booking reference',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only travelers (role USER) can download an e-ticket',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'The booking is unknown or belongs to another traveler',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The booking is not confirmed, or it has no e-ticket reference',
  })
  async eTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.bookings.getETicket(user, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': file.buffer.length.toString(),
    });
    return new StreamableFile(file.buffer);
  }

  @Get(':id')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Get a flight booking for its owner - FLT-21/FLT-23',
    description:
      'Returns flight, passenger, baggage and payable-total details for the booking owner. ' +
      'While the booking waits for payment this is the pending summary and the total is read from the same ' +
      'getPayable amount used by Payments. After payment it returns the confirmed booking with its unique ' +
      'booking reference, status CONFIRMED, null hold expiry, every one-way or round-trip segment, and the ' +
      'latest refund read through PAY-03\'s getLatestForBooking (null when none was issued). ' +
      'Passport/identity-document numbers, Stripe ids and payment credentials are never included.',
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
      'The booking is neither pending payment nor confirmed (for example expired or cancelled)',
  })
  getSummary(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookings.getSummary(user, id);
  }

  @Patch(':id/change-flight')
  @Roles(Role.USER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change a confirmed one-way flight booking - FLT-27',
    description:
      'Moves a CONFIRMED one-way booking to another flight with no price difference. The body is a single `flightId`; the booking cabin, route and passenger/seat counts are kept. ' +
      'The replacement must be a different SCHEDULED flight on the same route, in the same cabin and on the same airline, with enough available seats; the booked flight must not have departed. ' +
      'The booking total is recomputed from the stored passenger counts and the stored segment baggage fee plus the replacement cabin fare. Only an unchanged total is accepted: a higher or lower fare answers 409 with the difference and changes nothing, because charging/refunding a difference needs a Payments-owned contract that is documented but not implemented yet. ' +
      'In one MongoDB transaction the replacement cabin gets the booked seats using the same atomic availability guard as a hold, the booking is updated only while it is still CONFIRMED on the old flight, and the old booked seats are returned. A failed change or a concurrent winner rolls the whole transaction back, so old seats are never released on failure and are never released twice. ' +
      'The booking id, unique booking reference, passengers, payment reference and CONFIRMED status are preserved; no second booking, payment or refund is created. Round-trip bookings answer 409 until the product rule for them is agreed. Another traveler and an unknown id both answer 404; only role USER can call it.',
  })
  @ApiOkResponse({
    type: FlightBookingSummaryResponseDto,
    description:
      'The updated confirmed booking, with the replacement flight resolved in `flight` and `segments`; the booking id, reference, passengers and total are preserved.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Missing or invalid flightId, or an unknown body field',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only travelers (role USER) can change their flight booking',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'The booking or the replacement flight is unknown, belongs to another traveler, or the replacement has no such cabin',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The booking is not CONFIRMED, is a round trip, is already on that flight, has departed, the replacement changes the route/airline, is not SCHEDULED, has too few seats or cannot carry the booked baggage, the fare changes (the difference is in the message), or another request changed the booking first',
  })
  changeFlight(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangeFlightBookingDto,
  ) {
    return this.bookings.changeFlight(user, id, dto);
  }

  @Post(':id/cancel')
  @Roles(Role.USER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Preview or cancel a confirmed flight booking with a tier-based refund - FLT-26',
    description:
      "Two steps on the same owner-only endpoint. First send `{ confirm: false }`: it validates ownership and eligibility, computes the refund from the outbound segment's airline cancellation tiers (Payments' RefundCalculator, full booking total, fractional days before departure) and returns the amount, currency and applied tier without changing anything. " +
      'Then send `{ confirm: true, expectedRefundAmountCents: <the previewed amount> }`: the amount is recomputed and must still match, otherwise the request answers 409 with the current amount and nothing is cancelled or refunded (a fresh preview and confirmation are required). `confirm` is required and must be a boolean; a missing value is a validation error, never consent. ' +
      'On a match the confirmed amount is recorded on the booking (only while it is still CONFIRMED), then the booking goes through BookingLifecycle to CANCELLED, every segment\'s booked seats return to inventory in the same transaction, and the positive recorded refund is issued through PAY-03\'s RefundsService.issue. A zero refund (no applicable tier or a 0% tier) is recorded as 0, cancels and releases the seats without calling issue and returns `refund: null`. ' +
      'If issuing the refund fails after the cancellation (for example the payment provider is unavailable), the answer is 503 and the booking stays CANCELLED with its recorded amount. Sending the same confirmation again completes the refund with exactly the amount recorded at the first cancellation (no tier is re-read, the departure is not rechecked) and answers 200; it never returns the seats twice. A further retry after the refund was issued, a legacy cancellation with no recorded amount, or a cancellation that had nothing to refund answers 409. ' +
      'Only a CONFIRMED booking may be cancelled and only before the outbound departure; a round trip is cancelled as a whole using the outbound segment\'s airline and tier. Another traveler and an unknown id answer 404. A preview of a cancelled booking answers 409.',
  })
  @ApiOkResponse({ type: FlightBookingCancelResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Missing or non-boolean confirm, a missing/invalid expectedRefundAmountCents when confirm is true, or an unknown body field',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Only travelers (role USER) can cancel their flight booking',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'The booking is unknown or belongs to another traveler, or a booked flight segment is missing',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The booking is not CONFIRMED (pending, expired, completed, or a preview of an already cancelled one), the outbound flight has departed, the expected refund amount no longer matches (the current amount is in the message/details), another request cancelled it first, or a refund retry has nothing left to issue (already refunded, zero refund, or no recorded amount)',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description:
      'The booking is cancelled and its seats are released, but the refund could not be issued yet (the payment provider is unavailable). Send the same confirmation again to complete the refund with the recorded amount.',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelFlightBookingDto,
  ) {
    return this.bookings.cancel(user, id, dto);
  }

  @Post()
  @Roles(Role.USER)
  @ApiOperation({
    summary:
      'Create a flight booking with passenger and baggage details - FLT-19',
    description:
      "Derives adult/child/infant types from each passenger's date of birth using the outbound flight's local departure date " +
      '(ADULT 12+, CHILD 2-11, INFANT under 2; a round trip does not use the return leg date), ' +
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
