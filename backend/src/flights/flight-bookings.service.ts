import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, PipelineStage, Types } from 'mongoose';
import {
  AuthenticatedUser,
  BookingStatus,
  BookingType,
  CabinClass,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  HOLD_MINUTES,
  isCalendarDate,
  PaginatedResponse,
  PassengerType,
  PLATFORM_CURRENCY,
  Role,
  toPaginated,
} from '../common';
import {
  assertOwner,
  bookingVisibilityFilter,
} from '../common/ownership';
import { AirlinesService } from '../airlines';
import {
  BookingLifecycle,
  CancellationTier,
  RefundCalculator,
} from '../payments';
import { RefundsService, RefundSummary } from '../refunds';
import { FlightInventoryService } from './flight-inventory.service';
import {
  FlightBookingRefundDto,
  FlightBookingSummaryResponseDto,
  FlightBookingSummarySegmentDto,
} from './dto/flight-booking-summary-response.dto';
import {
  FlightBookingCancelResponseDto,
  FlightCancellationTierDto,
} from './dto/flight-booking-cancel-response.dto';
import { CancelFlightBookingDto } from './dto/cancel-flight-booking.dto';
import {
  daysBeforeDeparture,
  selectCancellationTier,
} from './utils/cancellation-refund';
import {
  FlightBookingListRowDto,
  FlightBookingListRowSource,
  toFlightBookingListRow,
} from './dto/flight-booking-list-row.dto';
import {
  FlightBookingGroup,
  MyFlightBookingsQueryDto,
} from './dto/my-flight-bookings-query.dto';
import {
  FlightBookingResponseDto,
  toBookingPassengerResponse,
  toFlightBookingSegmentResponse,
  toFlightBookingResponse,
} from './dto/flight-booking-response.dto';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBookingProvider } from './flight-booking.provider';
import {
  FlightETicketFile,
  FlightETicketService,
} from './flight-eticket.service';
import {
  BookingPassenger,
  FlightBooking,
  FlightBookingLean,
  FlightBookingSegment,
  getFlightBookingSegments,
} from './schemas/flight-booking.schema';
import { Flight, FlightLean } from './schemas/flight.schema';
import { toFlightResponse } from './dto/flight-response.dto';
import {
  bookingTotalCents,
  infantFareCents,
  PassengerCountsInput,
  seatsNeeded,
} from './utils/booking-price';

function inputError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    message: 'Validation failed',
    details: [{ field, message }],
  });
}

function passengerTypeFor(
  dateOfBirth: string,
  departureLocalDate: string,
  passengerIndex: number,
): PassengerType {
  const field = `passengers.${passengerIndex}.dateOfBirth`;
  if (!isCalendarDate(dateOfBirth)) {
    throw inputError(field, 'dateOfBirth must be a valid calendar date');
  }
  if (!isCalendarDate(departureLocalDate)) {
    throw new InternalServerErrorException(
      'The flight has an invalid local departure date',
    );
  }
  if (dateOfBirth > departureLocalDate) {
    throw inputError(field, 'dateOfBirth must be on or before departure');
  }

  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
  const [departureYear, departureMonth, departureDay] = departureLocalDate
    .split('-')
    .map(Number);
  const age =
    departureYear -
    birthYear -
    (departureMonth < birthMonth ||
    (departureMonth === birthMonth && departureDay < birthDay)
      ? 1
      : 0);

  if (age < 2) return PassengerType.INFANT;
  if (age < 12) return PassengerType.CHILD;
  return PassengerType.ADULT;
}

interface RequestedSegment {
  flightId: string;
  cabinClass: CabinClass;
}

interface PreparedSegment {
  flight: FlightLean;
  cabinClass: CabinClass;
  baggageFeeCents: number;
}

/** Everything FLT-26 needs to preview or confirm a cancellation at one point in time. */
interface CancellationContext {
  booking: FlightBookingLean;
  outbound: FlightBookingSegment;
  flight: FlightLean;
  daysBefore: number;
  refundAmountCents: number;
  appliedTier: CancellationTier | null;
}

/** Stored on the PAY-03 refund row so the traveler and support can see why it was issued. */
const CANCELLATION_REFUND_REASON = 'Flight booking cancelled by traveler';

@Injectable()
export class FlightBookingsService {
  private readonly logger = new Logger(FlightBookingsService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly model: Model<FlightBooking>,
    @InjectModel(Flight.name)
    private readonly flights: Model<Flight>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: FlightInventoryService,
    private readonly airlines: AirlinesService,
    private readonly bookingProvider: FlightBookingProvider,
    private readonly bookingLifecycle: BookingLifecycle,
    private readonly etickets: FlightETicketService,
    private readonly refunds: RefundsService,
  ) {}

  /** FLT-19: derive passenger types from date of birth and create the pending booking with baggage details. */
  async create(
    user: AuthenticatedUser,
    dto: CreateFlightBookingDto,
    now: Date = new Date(),
  ): Promise<FlightBookingResponseDto> {
    const requestedSegments = this.requestedSegments(dto);
    const flights = await Promise.all(
      requestedSegments.map((segment) =>
        this.inventory.loadBookableFlight(segment.flightId, now),
      ),
    );
    if (flights.length === 2) {
      const [outbound, returning] = flights;
      if (
        outbound.departureAirport !== returning.arrivalAirport ||
        outbound.arrivalAirport !== returning.departureAirport
      ) {
        throw inputError(
          'segments.1.flightId',
          'return flight must reverse the outbound route',
        );
      }
      if (returning.departureAt.getTime() <= outbound.arrivalAt.getTime()) {
        throw inputError(
          'segments.1.flightId',
          'return flight must depart after the outbound flight arrives',
        );
      }
    }

    const outbound = flights[0];
    const passengerTypes = dto.passengers.map((passenger, index) =>
      passengerTypeFor(
        passenger.dateOfBirth,
        outbound.departureLocalDate,
        index,
      ),
    );
    const passengerCounts: PassengerCountsInput = {
      adults: passengerTypes.filter((type) => type === PassengerType.ADULT)
        .length,
      children: passengerTypes.filter((type) => type === PassengerType.CHILD)
        .length,
      infants: passengerTypes.filter((type) => type === PassengerType.INFANT)
        .length,
    };
    if (passengerCounts.adults === 0) {
      throw inputError(
        'passengers',
        'at least one passenger aged 12 or older is required',
      );
    }
    if (passengerCounts.infants > passengerCounts.adults) {
      throw inputError(
        'passengers',
        'infants must not be more than adults (at most one infant per adult)',
      );
    }

    const hasExtraBags = dto.passengers.some(
      (passenger) => (passenger.extraBags?.length ?? 0) > 0,
    );
    const baggagePolicies = hasExtraBags
      ? await Promise.all(
          flights.map((flight) =>
            this.airlines.getBaggagePolicy(flight.airlineId.toString()),
          ),
        )
      : flights.map(() => null);
    if (hasExtraBags && baggagePolicies.some((policy) => policy === null)) {
      throw inputError(
        'passengers',
        'extra baggage must be available for every flight segment',
      );
    }

    const passengers: BookingPassenger[] = dto.passengers.map(
      (passenger, index) => {
        const extraBags = passenger.extraBags ?? [];
        let baggageFeeCents = 0;
        baggagePolicies.forEach((policy) => {
          if (!policy) return;
          if (extraBags.length > policy.maxExtraBags) {
            throw inputError(
              `passengers.${index}.extraBags`,
              `no more than ${policy.maxExtraBags} extra bags may be added per passenger on each flight segment`,
            );
          }
          baggageFeeCents +=
            extraBags.length * policy.extraBagPriceCents;
        });
        if (!Number.isSafeInteger(baggageFeeCents)) {
          throw inputError(
            `passengers.${index}.extraBags`,
            'the baggage fee exceeds the supported amount',
          );
        }
        return {
          fullName: passenger.fullName,
          dateOfBirth: passenger.dateOfBirth,
          passportOrIdNumber: passenger.passportOrIdNumber,
          passengerType: passengerTypes[index],
          extraBags,
          baggageFeeCents,
        };
      },
    );
    const baggageFeeCents = passengers.reduce(
      (total, passenger) => total + passenger.baggageFeeCents,
      0,
    );
    if (!Number.isSafeInteger(baggageFeeCents)) {
      throw inputError(
        'passengers',
        'the baggage fee exceeds the supported amount',
      );
    }

    const segments: PreparedSegment[] = flights.map((flight, index) => ({
      flight,
      cabinClass: requestedSegments[index].cabinClass,
      baggageFeeCents: passengers.reduce(
        (total, passenger) =>
          total +
          passenger.extraBags.length *
            (baggagePolicies[index]?.extraBagPriceCents ?? 0),
        0,
      ),
    }));
    return this.createPendingBooking(
      user,
      segments,
      passengerCounts,
      passengers,
      now,
    );
  }

  private requestedSegments(dto: CreateFlightBookingDto): RequestedSegment[] {
    if (dto.segments !== undefined) {
      if (dto.flightId !== undefined || dto.cabinClass !== undefined) {
        throw inputError(
          'segments',
          'use either segments or the one-way flightId and cabinClass fields',
        );
      }
      if (dto.segments.length !== 2) {
        throw inputError(
          'segments',
          'a round-trip booking must contain outbound and return legs',
        );
      }
      return dto.segments;
    }

    if (dto.flightId === undefined || dto.cabinClass === undefined) {
      throw inputError(
        'flightId',
        'provide flightId and cabinClass for a one-way booking, or two segments for a round trip',
      );
    }
    return [{ flightId: dto.flightId, cabinClass: dto.cabinClass }];
  }

  /**
   * FLT-25: the traveler's own bookings, grouped UPCOMING / PAST / CANCELLED and paginated.
   *
   * Ownership is part of the database query: the shared visibility helper is narrowed to role USER,
   * so no caller can widen "my bookings" to an admin/moderator view by passing an id. The group is
   * computed in MongoDB from the outbound segment's flight `departureAt` (one `$lookup`), so skip,
   * limit and the total are correct without loading the whole collection into memory. Rows are
   * newest first (`createdAt`, then `_id`) so pages are deterministic and stable.
   * `now` is a parameter only so tests can fix the clock.
   */
  async listMine(
    user: AuthenticatedUser,
    query: MyFlightBookingsQueryDto,
    now: Date = new Date(),
  ): Promise<PaginatedResponse<FlightBookingListRowDto>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const filter = this.myBookingsFilter(user);

    const pageStages: PipelineStage[] = [
      { $match: filter },
      // Newest first; `_id` breaks ties so a row never shows on two pages.
      { $sort: { createdAt: -1, _id: -1 } },
    ];
    if (query.group) {
      // Filtering needs the computed group, so it must happen before skip/limit.
      pageStages.push(
        ...this.bookingGroupStages(now),
        { $match: { group: query.group } },
      );
    }
    pageStages.push({ $skip: (page - 1) * limit }, { $limit: limit });
    if (!query.group) {
      // Without a filter the group only labels the page rows, so it is computed after the limit.
      pageStages.push(...this.bookingGroupStages(now));
    }
    pageStages.push({
      $project: {
        outboundFlight: 0,
        outboundFlightId: 0,
        outboundDepartureAt: 0,
      },
    });

    const [rows, total] = await Promise.all([
      this.model.aggregate<FlightBookingListRowSource>(pageStages),
      this.countMyBookings(filter, query.group, now),
    ]);

    const flightIds = new Set<string>();
    for (const row of rows) {
      for (const segment of getFlightBookingSegments(row)) {
        flightIds.add(segment.flightId.toString());
      }
    }
    const flightDocs = flightIds.size
      ? await this.flights
          .find({
            _id: { $in: [...flightIds].map((id) => new Types.ObjectId(id)) },
          })
          .lean<FlightLean[]>()
          .exec()
      : [];
    const flightsById = new Map(
      flightDocs.map((flight) => [flight._id.toString(), flight]),
    );

    const items = rows.map((row) => {
      const segments: FlightBookingSummarySegmentDto[] =
        getFlightBookingSegments(row).map((segment) => {
          const flight = flightsById.get(segment.flightId.toString());
          if (!flight) {
            throw new NotFoundException('A booked flight segment was not found');
          }
          return {
            ...toFlightBookingSegmentResponse(segment),
            flight: toFlightResponse(flight, now),
          };
        });
      const [outbound] = segments;
      if (!outbound) {
        throw new InternalServerErrorException(
          'The flight booking has no outbound segment',
        );
      }
      return toFlightBookingListRow(row, segments, outbound.flight);
    });

    return toPaginated(items, total, page, limit);
  }

  /**
   * "My bookings" is owner-only. A USER's shared visibility filter is their own `userId`; any other
   * role would match broader data, so it is matched to nothing here as well as by the route's
   * `@Roles(Role.USER)`. Aggregation pipelines bypass Mongoose casting, so the id is cast explicitly.
   */
  private myBookingsFilter(user: AuthenticatedUser): Record<string, unknown> {
    const scope = bookingVisibilityFilter(user);
    if (user.role !== Role.USER || typeof scope.userId !== 'string') {
      return { _id: { $in: [] } };
    }
    return { userId: new Types.ObjectId(scope.userId) };
  }

  /**
   * The stages that derive each booking's group from the outbound segment's flight. `segments` is
   * optional on legacy one-way records, so the top-level `flightId` is the fallback. The departure
   * date is read from the flight document; the booking itself stores no departure date.
   */
  private bookingGroupStages(now: Date): PipelineStage[] {
    return [
      {
        $addFields: {
          outboundFlightId: {
            $ifNull: [{ $arrayElemAt: ['$segments.flightId', 0] }, '$flightId'],
          },
        },
      },
      {
        $lookup: {
          from: this.flights.collection.name,
          let: { outboundFlightId: '$outboundFlightId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$outboundFlightId'] } } },
            { $project: { departureAt: 1 } },
          ],
          as: 'outboundFlight',
        },
      },
      {
        $addFields: {
          outboundDepartureAt: {
            $arrayElemAt: ['$outboundFlight.departureAt', 0],
          },
        },
      },
      {
        $addFields: {
          group: {
            $switch: {
              branches: [
                {
                  case: { $eq: ['$status', BookingStatus.CANCELLED] },
                  then: FlightBookingGroup.CANCELLED,
                },
                {
                  case: { $gt: ['$outboundDepartureAt', now] },
                  then: FlightBookingGroup.UPCOMING,
                },
              ],
              default: FlightBookingGroup.PAST,
            },
          },
        },
      },
    ];
  }

  /** The total after the optional group filter, without counting rows in the application. */
  private async countMyBookings(
    filter: Record<string, unknown>,
    group: FlightBookingGroup | undefined,
    now: Date,
  ): Promise<number> {
    if (!group) return this.model.countDocuments(filter).exec();
    const rows = await this.model.aggregate<{ count: number }>([
      { $match: filter },
      ...this.bookingGroupStages(now),
      { $match: { group } },
      { $count: 'count' },
    ]);
    return rows[0]?.count ?? 0;
  }

  /**
   * FLT-21/FLT-23: show the booking only to its owner, resolving an overdue hold first. While the booking
   * waits for payment the response is the unchanged pending summary; once it is confirmed the same shape is
   * returned with the booking reference, status CONFIRMED and a null hold expiry. Another owner and an
   * unknown id both answer 404, and expired/cancelled bookings keep answering 409.
   */
  async getSummary(
    user: AuthenticatedUser,
    id: string,
    now: Date = new Date(),
  ): Promise<FlightBookingSummaryResponseDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Flight booking not found');
    }
    const userId = new Types.ObjectId(user.userId);
    const ownerFilter = { _id: new Types.ObjectId(id), userId };
    const owned = await this.model
      .findOne(ownerFilter)
      .lean<FlightBookingLean>()
      .exec();
    if (!owned) throw new NotFoundException('Flight booking not found');

    await this.bookingLifecycle.expireIfDue(BookingType.FLIGHT, id, now);

    const booking = await this.model
      .findOne(ownerFilter)
      .lean<FlightBookingLean>()
      .exec();
    if (!booking) throw new NotFoundException('Flight booking not found');
    const payable = await this.bookingProvider.getPayable(id, user.userId);
    if (!payable) throw new NotFoundException('Flight booking not found');
    if (
      (booking.status !== BookingStatus.PENDING_PAYMENT &&
        booking.status !== BookingStatus.CONFIRMED) ||
      payable.status !== booking.status
    ) {
      throw new ConflictException(
        'A booking is available only while it is pending payment or after it is confirmed',
      );
    }

    const segments = getFlightBookingSegments(booking);
    const segmentFlights = await Promise.all(
      segments.map((segment) =>
        this.flights.findById(segment.flightId).lean<FlightLean>().exec(),
      ),
    );
    const summarySegments = segments.map((segment, index) => {
      const flight = segmentFlights[index];
      if (!flight) {
        throw new NotFoundException('A booked flight segment was not found');
      }
      return {
        ...toFlightBookingSegmentResponse(segment),
        flight: toFlightResponse(flight),
      };
    });
    const outboundSummary = summarySegments[0];
    if (!outboundSummary) {
      throw new InternalServerErrorException(
        'The flight booking has no outbound segment',
      );
    }

    // PAY-03's published read contract: the refund is its exact summary, or null when none was issued.
    const refund =
      booking.status === BookingStatus.CONFIRMED
        ? await this.refunds.getLatestForBooking(BookingType.FLIGHT, id)
        : null;

    return {
      id: booking._id.toString(),
      flight: outboundSummary.flight,
      segments: summarySegments,
      cabinClass: booking.cabinClass,
      passengerCounts: {
        adults: booking.passengerCounts.adults,
        children: booking.passengerCounts.children,
        infants: booking.passengerCounts.infants,
      },
      passengers: (booking.passengers ?? []).map(toBookingPassengerResponse),
      baggageFeeCents: booking.baggageFeeCents ?? 0,
      totalCents: payable.amountCents,
      currency: payable.currency,
      status: payable.status,
      holdExpiresAt: payable.holdExpiresAt?.toISOString() ?? null,
      ...(booking.bookingReference
        ? { bookingReference: booking.bookingReference }
        : {}),
      ...(booking.status === BookingStatus.CONFIRMED
        ? { refund: refund ? this.toRefundResponse(refund) : null }
        : {}),
    };
  }

  private toRefundResponse(refund: RefundSummary): FlightBookingRefundDto {
    return {
      id: refund.id,
      bookingType: refund.bookingType,
      bookingId: refund.bookingId,
      status: refund.status,
      amountCents: refund.amountCents,
      currency: refund.currency,
      ...(refund.reason !== undefined ? { reason: refund.reason } : {}),
      createdAt: refund.createdAt,
    };
  }

  /**
   * FLT-26: preview (`confirm: false`) or cancel (`confirm: true`) the owner's CONFIRMED booking
   * before its outbound departure.
   *
   * The refund comes from the outbound segment's stored airline tiers (`AirlinesService
   * .getCancellationTiers`) and Payments' `RefundCalculator.compute`, with the full booking total
   * and fractional days remaining — a round trip is cancelled as a whole by its outbound leg.
   * The amount is computed twice: once for the preview/response and once immediately before the
   * transition, so a policy or clock change cannot cancel for an amount the traveler did not see.
   * A changed amount is a 409 that carries the current amount and changes nothing.
   *
   * The confirmed amount is then recorded on the booking — with a conditional write that only
   * matches while it is still CONFIRMED — before `BookingLifecycle.transition` releases every
   * segment's seats once, in the same transaction. Only after the transition commits is the
   * positive recorded refund issued through PAY-03; 0 is never sent to `issue` (it only accepts a
   * positive integer). If issuing fails, the booking stays CANCELLED with the amount it recorded
   * and the answer is 503; cancelling again completes the refund from that recorded amount (see
   * `completeRecordedRefund`) instead of recalculating it or returning the seats twice. MongoDB
   * cannot make the Stripe refund and the booking transaction atomic; a refund failure after the
   * commit is surfaced, never swallowed.
   */
  async cancel(
    user: AuthenticatedUser,
    id: string,
    dto: CancelFlightBookingDto,
    now: Date = new Date(),
  ): Promise<FlightBookingCancelResponseDto> {
    const booking = await this.loadOwnedBooking(user, id);

    // Already cancelled: only a confirmation can complete a refund that failed the first time.
    // A preview of a cancelled booking stays a 409, like every other non-CONFIRMED booking.
    if (booking.status === BookingStatus.CANCELLED) {
      return this.completeRecordedRefund(booking, dto, now);
    }

    const preview = await this.cancellationContext(booking, now);
    if (!dto.confirm) {
      return this.toCancellationResponse(preview, false, null);
    }
    if (dto.expectedRefundAmountCents !== preview.refundAmountCents) {
      throw this.refundAmountChanged(preview.refundAmountCents);
    }

    // Recheck status, departure and the amount immediately before the only status write. The
    // transition's own conditional update is the final guard against another request winning.
    const freshBooking = await this.loadOwnedBooking(user, id);
    const fresh = await this.cancellationContext(freshBooking, now);
    if (fresh.refundAmountCents !== dto.expectedRefundAmountCents) {
      throw this.refundAmountChanged(fresh.refundAmountCents);
    }

    // Record what this cancellation refunds while the booking is still CONFIRMED. A concurrent
    // request that already changed the booking makes this write match nothing, and an amount
    // recorded by another request is never replaced with a different one, so exactly one caller
    // reaches the transition (and therefore the refund).
    const recorded = await this.model
      .updateOne(
        {
          _id: fresh.booking._id,
          userId: fresh.booking.userId,
          status: BookingStatus.CONFIRMED,
          $or: [
            { cancellationRefundCents: { $exists: false } },
            { cancellationRefundCents: fresh.refundAmountCents },
          ],
        },
        {
          $set: {
            cancellationRefundCents: fresh.refundAmountCents,
            cancellationRequestedAt: now,
          },
        },
      )
      .exec();
    if (recorded.matchedCount !== 1) {
      throw new ConflictException(
        'The flight booking was changed by another request; nothing was cancelled',
      );
    }

    await this.bookingLifecycle.transition(
      BookingType.FLIGHT,
      id,
      BookingStatus.CANCELLED,
    );

    const refund = await this.issueRecordedRefund(
      id,
      fresh.refundAmountCents,
    );
    return this.toCancellationResponse(fresh, true, refund);
  }

  /**
   * The booking is already CANCELLED. When its cancellation recorded a positive refund that was
   * not issued (for example Stripe was down), this retry issues exactly that recorded amount: no
   * tier is read, no amount is recomputed or replaced, and the departure is not rechecked because
   * the cancellation itself was already valid. A preview stays a 409. A cancellation with nothing
   * to refund, a legacy cancellation with no recorded amount, and an already-issued refund are 409
   * (the hotel-cancellation precedent); none of them calls PAY-03.
   */
  private async completeRecordedRefund(
    booking: FlightBookingLean,
    dto: CancelFlightBookingDto,
    now: Date,
  ): Promise<FlightBookingCancelResponseDto> {
    if (!dto.confirm) {
      throw new ConflictException(
        'Only a confirmed flight booking can be cancelled',
      );
    }

    const recorded = booking.cancellationRefundCents;
    if (recorded === undefined) {
      throw new ConflictException(
        'This flight booking was cancelled without a recorded refund amount, so no refund can be issued from it',
      );
    }
    if (dto.expectedRefundAmountCents !== recorded) {
      throw this.refundAmountChanged(recorded);
    }
    if (recorded === 0) {
      throw new ConflictException(
        'This flight booking was cancelled without a refund; there is nothing left to refund',
      );
    }
    if (
      await this.refunds.getLatestForBooking(
        BookingType.FLIGHT,
        booking._id.toString(),
      )
    ) {
      throw new ConflictException(
        'This flight booking is already cancelled and its refund was issued',
      );
    }

    const context = await this.cancelledContext(booking, now);
    const refund = await this.issueRecordedRefund(
      booking._id.toString(),
      recorded,
    );
    return this.toCancellationResponse(context, true, refund);
  }

  /** The caller's own booking; another traveler and an unknown id are both 404. */
  private async loadOwnedBooking(
    user: AuthenticatedUser,
    id: string,
  ): Promise<FlightBookingLean> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Flight booking not found');
    }
    const booking = await this.model
      .findById(id)
      .lean<FlightBookingLean>()
      .exec();
    if (!booking) throw new NotFoundException('Flight booking not found');
    assertOwner(user, { ownerId: booking.userId }, 'Flight booking not found');
    return booking;
  }

  /**
   * Checks that the booking is still CONFIRMED and inside the cancellation window and calculates
   * the current tier refund. Pure of writes: used by the preview, the confirmation and the
   * pre-transition recheck.
   */
  private async cancellationContext(
    booking: FlightBookingLean,
    now: Date,
  ): Promise<CancellationContext> {
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        'Only a confirmed flight booking can be cancelled',
      );
    }

    // The outbound segment decides the window, the airline tiers and therefore the refund; the
    // helper also supplies the legacy one-way fallback when `segments` is absent.
    const [outbound] = getFlightBookingSegments(booking);
    if (!outbound) {
      throw new InternalServerErrorException(
        'The flight booking has no outbound segment',
      );
    }
    const flight = await this.flights
      .findById(outbound.flightId)
      .lean<FlightLean>()
      .exec();
    if (!flight) {
      throw new NotFoundException('A booked flight segment was not found');
    }
    if (now.getTime() >= flight.departureAt.getTime()) {
      throw new ConflictException(
        'A flight booking cannot be cancelled at or after its outbound departure',
      );
    }

    const daysBefore = daysBeforeDeparture(flight.departureAt, now);
    const tiers = await this.airlines.getCancellationTiers(
      outbound.airlineId.toString(),
    );
    return {
      booking,
      outbound,
      flight,
      daysBefore,
      refundAmountCents: RefundCalculator.compute({
        tiers,
        daysBefore,
        totalCents: booking.totalCents,
      }),
      appliedTier: selectCancellationTier(tiers, daysBefore),
    };
  }

  /**
   * Loads the outbound flight of an already-cancelled booking for the recovery response. The
   * departure may have passed by now; `daysBefore` is then negative and the tier is not re-read.
   */
  private async cancelledContext(
    booking: FlightBookingLean,
    now: Date,
  ): Promise<CancellationContext> {
    const [outbound] = getFlightBookingSegments(booking);
    if (!outbound) {
      throw new InternalServerErrorException(
        'The flight booking has no outbound segment',
      );
    }
    const flight = await this.flights
      .findById(outbound.flightId)
      .lean<FlightLean>()
      .exec();
    if (!flight) {
      throw new NotFoundException('A booked flight segment was not found');
    }
    return {
      booking,
      outbound,
      flight,
      daysBefore: daysBeforeDeparture(flight.departureAt, now),
      refundAmountCents: booking.cancellationRefundCents ?? 0,
      appliedTier: null,
    };
  }

  /**
   * Issues the recorded refund (nothing for 0) and maps the PAY-03 summary. A transient failure
   * becomes a 503 asking the traveler to send the request again: the booking is already CANCELLED,
   * so the retry finishes the refund with the same amount and PAY-03's per-payment idempotency key.
   * If a concurrent request created the refund first, that known duplicate is returned instead of
   * an error; any other refusal from the refund rules is rethrown untouched.
   */
  private async issueRecordedRefund(
    id: string,
    amountCents: number,
  ): Promise<FlightBookingRefundDto | null> {
    if (amountCents <= 0) return null;
    try {
      const issued = await this.refunds.issue({
        bookingType: BookingType.FLIGHT,
        bookingId: id,
        amountCents,
        reason: CANCELLATION_REFUND_REASON,
      });
      return this.toRefundResponse(issued);
    } catch (error) {
      if (error instanceof ConflictException) {
        const existing = await this.refunds.getLatestForBooking(
          BookingType.FLIGHT,
          id,
        );
        if (existing) return this.toRefundResponse(existing);
      }
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Flight booking ${id} was cancelled but its refund of ${amountCents} cents could not be issued`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        'The flight booking is cancelled and its seats are released, but the refund could not be issued yet. Send the cancel request again to retry the refund.',
      );
    }
  }

  private refundAmountChanged(currentAmountCents: number): ConflictException {
    return new ConflictException({
      message: `The refund amount is now ${currentAmountCents} cents; preview again and confirm the new amount`,
      details: [
        {
          field: 'expectedRefundAmountCents',
          message: `expectedRefundAmountCents does not match the current refund of ${currentAmountCents} cents`,
        },
      ],
    });
  }

  private toCancellationResponse(
    context: CancellationContext,
    cancelled: boolean,
    refund: FlightBookingRefundDto | null,
  ): FlightBookingCancelResponseDto {
    const appliedTier: FlightCancellationTierDto | null = context.appliedTier
      ? {
          daysBeforeThreshold: context.appliedTier.daysBeforeThreshold,
          refundPercent: context.appliedTier.refundPercent,
        }
      : null;
    // On a refund-recovery retry the tier is not re-read (only the stored amount is used), so the
    // percentage is derived from that amount instead of pretending a tier was selected now.
    const refundPercent = appliedTier
      ? appliedTier.refundPercent
      : context.booking.totalCents > 0
        ? Math.round(
            (context.refundAmountCents / context.booking.totalCents) * 100,
          )
        : 0;
    return {
      id: context.booking._id.toString(),
      status: cancelled ? BookingStatus.CANCELLED : context.booking.status,
      cancelled,
      ...(context.booking.bookingReference
        ? { bookingReference: context.booking.bookingReference }
        : {}),
      currency: context.booking.currency,
      totalCents: context.booking.totalCents,
      outboundFlightId: context.outbound.flightId.toString(),
      outboundAirlineId: context.outbound.airlineId.toString(),
      outboundDepartureAt: context.flight.departureAt.toISOString(),
      daysBefore: context.daysBefore,
      refundAmountCents: context.refundAmountCents,
      refundPercent,
      appliedTier,
      refund,
    };
  }

  /**
   * FLT-23: generate the owner's e-ticket for a confirmed booking that has a reference. Someone
   * else's booking and a missing one both answer 404 (ids cannot be probed); a booking that is not
   * confirmed, or a historical confirmed booking without a reference, answers 409. The PDF is
   * rendered for this request only and never stored.
   */
  async getETicket(
    user: AuthenticatedUser,
    id: string,
  ): Promise<FlightETicketFile> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Flight booking not found');
    }
    const booking = await this.model
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(user.userId),
      })
      .lean<FlightBookingLean>()
      .exec();
    if (!booking) throw new NotFoundException('Flight booking not found');
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        'An e-ticket is available only after the booking is confirmed',
      );
    }
    if (!booking.bookingReference) {
      throw new ConflictException('This booking has no e-ticket reference');
    }

    const segments = getFlightBookingSegments(booking);
    const segmentFlights = await Promise.all(
      segments.map((segment) =>
        this.flights.findById(segment.flightId).lean<FlightLean>().exec(),
      ),
    );
    if (segmentFlights.some((flight) => flight === null)) {
      throw new NotFoundException('A booked flight segment was not found');
    }

    const data = this.etickets.buildData(
      booking,
      segmentFlights as FlightLean[],
    );
    return {
      buffer: await this.etickets.render(data),
      filename: `e-ticket-${booking.bookingReference}.pdf`,
      bookingReference: booking.bookingReference,
    };
  }

  /**
   * FLT-22: the traveler proceeds to payment. In ONE transaction the requested seats are reserved with a single
   * conditional update (only if enough remain) and a PENDING_PAYMENT booking is created, held for HOLD_MINUTES.
   * If the hold fails nothing is written; if the booking insert fails the seats are not held either.
   * Infants take no seat. The traveler comes from the login and the price from the cabin: neither is in the body.
   * `now` is a parameter only so tests can fix the clock.
   */
  async hold(
    user: AuthenticatedUser,
    dto: HoldFlightBookingDto,
    now: Date = new Date(),
  ): Promise<FlightBookingResponseDto> {
    if (dto.infants > dto.adults) {
      throw inputError(
        'infants',
        'infants must not be more than adults (at most one infant per adult)',
      );
    }

    const flight = await this.inventory.loadBookableFlight(dto.flightId, now);
    const counts: PassengerCountsInput = {
      adults: dto.adults,
      children: dto.children,
      infants: dto.infants,
    };
    return this.createPendingBooking(
      user,
      [{ flight, cabinClass: dto.cabinClass, baggageFeeCents: 0 }],
      counts,
      undefined,
      now,
    );
  }

  private async createPendingBooking(
    user: AuthenticatedUser,
    requestedSegments: PreparedSegment[],
    passengerCounts: PassengerCountsInput,
    passengers: BookingPassenger[] | undefined,
    now: Date,
  ): Promise<FlightBookingResponseDto> {
    const seats = seatsNeeded(passengerCounts);
    const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

    // Both legs and their seat counters commit together; any failed hold aborts the transaction.
    let booking: FlightBookingLean | undefined;
    await this.connection.transaction(async (session) => {
      const segments: FlightBookingSegment[] = [];
      let totalCents = 0;
      for (const [index, requested] of requestedSegments.entries()) {
        const cabin = await this.inventory.holdSeats(
          requested.flight._id,
          requested.cabinClass,
          seats,
          session,
        );
        if (!cabin) {
          if (
            !(await this.inventory.cabinExists(
              requested.flight._id,
              requested.cabinClass,
              session,
            ))
          ) {
            throw new NotFoundException(
              `Flight segment ${index + 1} has no such cabin`,
            );
          }
          throw new ConflictException(
            `Not enough seats left in flight segment ${index + 1}`,
          );
        }

        passengers?.forEach((passenger, passengerIndex) => {
          passenger.extraBags.forEach((bag, bagIndex) => {
            if (bag.weightKg > cabin.maxBagWeightKg) {
              throw inputError(
                `passengers.${passengerIndex}.extraBags.${bagIndex}.weightKg`,
                `weightKg must be at most ${cabin.maxBagWeightKg} kg for flight segment ${index + 1}`,
              );
            }
          });
        });

        const fare = cabin.priceCents;
        const infantFare = infantFareCents(fare);
        segments.push({
          flightId: requested.flight._id,
          airlineId: requested.flight.airlineId,
          cabinClass: requested.cabinClass,
          seats,
          farePerPassengerCents: fare,
          infantFareCents: infantFare,
          baggageFeeCents: requested.baggageFeeCents,
        });
        totalCents += bookingTotalCents(
          fare,
          passengerCounts,
          requested.baggageFeeCents,
        );
      }

      const outbound = segments[0];
      if (!outbound || !Number.isSafeInteger(totalCents)) {
        throw new InternalServerErrorException(
          'The booking has invalid segment pricing',
        );
      }
      const baggageFeeCents = segments.reduce(
        (total, segment) => total + segment.baggageFeeCents,
        0,
      );
      if (!Number.isSafeInteger(baggageFeeCents)) {
        throw inputError(
          'passengers',
          'the baggage fee exceeds the supported amount',
        );
      }

      const [created] = await this.model.create(
        [
          {
            userId: new Types.ObjectId(user.userId),
            airlineId: outbound.airlineId,
            flightId: outbound.flightId,
            segments,
            cabinClass: outbound.cabinClass,
            passengerCounts,
            ...(passengers ? { passengers } : {}),
            seats,
            farePerPassengerCents: outbound.farePerPassengerCents,
            infantFareCents: outbound.infantFareCents,
            baggageFeeCents,
            totalCents,
            currency: PLATFORM_CURRENCY,
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt,
          },
        ],
        { session },
      );
      booking = created.toObject<FlightBookingLean>();
    });

    if (!booking) {
      throw new InternalServerErrorException(
        'The booking transaction completed without creating a booking',
      );
    }
    return toFlightBookingResponse(booking);
  }
}
