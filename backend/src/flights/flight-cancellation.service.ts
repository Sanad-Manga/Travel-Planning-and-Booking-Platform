import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  BookingStatus,
  BookingType,
  FlightStatus,
  NotificationType,
  Role,
} from '../common';
import { NotificationsService } from '../notifications';
import { BookingLifecycle } from '../payments';
import { RefundsService } from '../refunds';
import {
  FlightCancellationFailureDto,
  FlightCancellationResponseDto,
} from './dto/cancel-flight.dto';
import {
  FlightBooking,
  FlightBookingLean,
} from './schemas/flight-booking.schema';
import { Flight, FlightLean } from './schemas/flight.schema';
import { effectiveFlightStatus } from './utils/flight-status';

const REFUND_REASON = 'Flight cancelled by the airline';

/**
 * FLT-06: an airline moderator cancels THEIR OWN scheduled flight. In order:
 *
 * 1. The flight becomes CANCELLED in one atomic write (only while it is still SCHEDULED and has not
 *    left), so nothing new can be searched or booked from that moment on.
 * 2. Every PENDING_PAYMENT hold is released (the seats go back) through BookingLifecycle.
 * 3. Every CONFIRMED booking is cancelled through BookingLifecycle (its booked seats go back) and
 *    refunded in full through PAY-03, then its passenger is notified.
 *
 * A round-trip booking that includes this flight on either leg is cancelled and refunded as a whole.
 *
 * The work is spread over several writes, so it can stop half way (a Stripe outage, a crash). The
 * flight stays CANCELLED and the response lists what is still pending; sending the same request
 * again picks up exactly that (a CANCELLED flight owned by the caller is accepted for that reason),
 * and PAY-03's per-payment idempotency means nobody is refunded twice.
 */
@Injectable()
export class FlightCancellationService {
  private readonly logger = new Logger(FlightCancellationService.name);

  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly lifecycle: BookingLifecycle,
    private readonly refunds: RefundsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** `now` is a parameter only so tests can fix the clock. */
  async cancel(
    user: AuthenticatedUser,
    flightId: string,
    now: Date = new Date(),
  ): Promise<FlightCancellationResponseDto> {
    if (user.role !== Role.AIRLINE_MODERATOR || !user.airlineId) {
      throw new ForbiddenException(
        'Only an airline moderator can cancel flights',
      );
    }
    const flight = Types.ObjectId.isValid(flightId)
      ? await this.flights.findById(flightId).lean<FlightLean>().exec()
      : null;
    if (!flight) throw new NotFoundException('Flight not found');
    if (flight.airlineId.toString() !== user.airlineId) {
      throw new ForbiddenException('You can only cancel your own flights');
    }

    // A flight already CANCELLED is a retry of an unfinished cancellation; only a flight that
    // cannot be cancelled any more (departed) is refused.
    const resuming = flight.status === FlightStatus.CANCELLED;
    if (!resuming) {
      const status = effectiveFlightStatus(flight, now);
      if (status !== FlightStatus.SCHEDULED) {
        throw new ConflictException(`A ${status} flight cannot be cancelled`);
      }
      const updated = await this.flights
        .findOneAndUpdate(
          {
            _id: flight._id,
            status: FlightStatus.SCHEDULED,
            departureAt: { $gt: now },
          },
          { $set: { status: FlightStatus.CANCELLED } },
        )
        .lean<FlightLean>()
        .exec();
      if (!updated) {
        throw new ConflictException(
          'The flight changed while it was being cancelled; check its status and try again',
        );
      }
    }

    const result = {
      bookingsCancelled: 0,
      holdsReleased: 0,
      refundsIssued: 0,
      refundedCents: 0,
      passengersNotified: 0,
      pending: [] as FlightCancellationFailureDto[],
    };

    const affected = await this.bookings
      .find({
        $or: [{ flightId: flight._id }, { 'segments.flightId': flight._id }],
        status: {
          $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
        },
      })
      .sort({ _id: 1 })
      .lean<FlightBookingLean[]>()
      .exec();

    for (const booking of affected) {
      const id = booking._id.toString();
      try {
        if (booking.status === BookingStatus.PENDING_PAYMENT) {
          await this.releaseHold(booking, flight, now, result);
        } else {
          await this.cancelConfirmed(booking, flight, now, result);
        }
      } catch (error) {
        this.noteFailure(result.pending, id, error);
      }
    }

    if (resuming) {
      // Bookings cancelled by an earlier, interrupted run whose refund never went through.
      const unrefunded = await this.bookings
        .find({
          $or: [{ flightId: flight._id }, { 'segments.flightId': flight._id }],
          status: BookingStatus.CANCELLED,
          cancellationRequestedAt: { $exists: true },
          $expr: { $eq: ['$cancellationRefundCents', '$totalCents'] },
        })
        .sort({ _id: 1 })
        .lean<FlightBookingLean[]>()
        .exec();
      for (const booking of unrefunded) {
        try {
          // The passenger was told when the booking was cancelled; only a refund created now counts.
          await this.refund(booking, result, false);
        } catch (error) {
          this.noteFailure(result.pending, booking._id.toString(), error);
        }
      }
    }

    return {
      flightId: flight._id.toString(),
      status: FlightStatus.CANCELLED,
      ...result,
      complete: result.pending.length === 0,
    };
  }

  /**
   * Releases one unpaid hold. The hold goes through the lifecycle's normal hold-ending path (which asks PaymentActivity): a payment
   * that is still in flight leaves the hold alone (a repeat of the request picks it up later), and
   * one that actually succeeded makes the booking CONFIRMED, which then needs cancelling and a refund.
   */
  private async releaseHold(
    booking: FlightBookingLean,
    flight: FlightLean,
    now: Date,
    result: Progress,
  ): Promise<void> {
    const id = booking._id.toString();
    // The lifecycle's own hold-ending path asks PaymentActivity what to do with the hold. It only
    // acts on a hold that is due, so it is asked "as of" the moment the hold would have run out.
    const dueAt =
      booking.holdExpiresAt && booking.holdExpiresAt.getTime() > now.getTime()
        ? booking.holdExpiresAt
        : now;
    const resolved = await this.lifecycle.expireIfDue(
      BookingType.FLIGHT,
      id,
      dueAt,
    );
    const after = await this.bookings
      .findById(booking._id)
      .lean<FlightBookingLean>()
      .exec();
    if (!resolved || after?.status === BookingStatus.PENDING_PAYMENT) {
      result.pending.push({
        bookingId: id,
        message:
          'A payment is still being processed for this hold; send the cancel request again shortly to release it',
      });
      return;
    }
    if (after?.status === BookingStatus.EXPIRED) {
      result.holdsReleased++;
    } else if (after?.status === BookingStatus.CONFIRMED) {
      // The payment had in fact succeeded, so the booking is real: cancel and refund it.
      await this.cancelConfirmed(after, flight, now, result);
    }
  }

  private async cancelConfirmed(
    booking: FlightBookingLean,
    flight: FlightLean,
    now: Date,
    result: Progress,
  ): Promise<void> {
    // The refund amount is recorded while the booking is still CONFIRMED (the FLT-26 pattern), so a
    // refund that fails after the cancellation can be retried for exactly this amount. A booking a
    // traveler has already started cancelling keeps its own recorded amount and is left to them.
    const recorded = await this.bookings
      .updateOne(
        {
          _id: booking._id,
          status: BookingStatus.CONFIRMED,
          $or: [
            { cancellationRequestedAt: { $exists: false } },
            // recorded by an earlier, interrupted run of this same airline cancellation
            { $expr: { $eq: ['$cancellationRefundCents', '$totalCents'] } },
          ],
        },
        {
          $set: {
            cancellationRefundCents: booking.totalCents,
            cancellationRequestedAt: now,
          },
        },
      )
      .exec();
    if (recorded.matchedCount === 0) {
      throw new ConflictException(
        'This booking is being cancelled by the traveler; send the cancel request again to finish it',
      );
    }

    await this.lifecycle.transition(
      BookingType.FLIGHT,
      booking._id.toString(),
      BookingStatus.CANCELLED,
    );
    result.bookingsCancelled++;

    await this.notifyPassenger(booking, flight, result);
    await this.refund(booking, result);
  }

  /** Issues the full refund. A refund that already exists (a repeat, or a concurrent request) counts as done. */
  private async refund(
    booking: FlightBookingLean,
    result: Progress,
    countExisting = true,
  ): Promise<void> {
    if (booking.totalCents <= 0) return;
    const id = booking._id.toString();
    let amountCents: number;
    let created = true;
    try {
      const issued = await this.refunds.issue({
        bookingType: BookingType.FLIGHT,
        bookingId: id,
        amountCents: booking.totalCents,
        reason: REFUND_REASON,
      });
      amountCents = issued.amountCents;
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const existing = await this.refunds.getLatestForBooking(
        BookingType.FLIGHT,
        id,
      );
      if (!existing) throw error;
      amountCents = existing.amountCents;
      created = false;
    }
    if (!created && !countExisting) return;
    result.refundsIssued++;
    result.refundedCents += amountCents;
  }

  private async notifyPassenger(
    booking: FlightBookingLean,
    flight: FlightLean,
    result: Progress,
  ): Promise<void> {
    await this.notifications.notify({
      userId: booking.userId.toString(),
      type: NotificationType.BOOKING_CANCELLED,
      title: `Flight ${flight.flightNumber} was cancelled`,
      message:
        booking.totalCents > 0
          ? `The airline cancelled flight ${flight.flightNumber}, so your booking has been cancelled. You are being refunded in full.`
          : `The airline cancelled flight ${flight.flightNumber}, so your booking has been cancelled.`,
      link: `/flight-bookings/${booking._id.toString()}`,
    });
    result.passengersNotified++;
  }

  private noteFailure(
    pending: FlightCancellationFailureDto[],
    bookingId: string,
    error: unknown,
  ): void {
    if (!(error instanceof HttpException)) {
      this.logger.error(
        `Cancelling flight booking ${bookingId} after its flight was cancelled failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    pending.push({
      bookingId,
      message:
        error instanceof HttpException
          ? error.message
          : 'This booking could not be finished yet; send the cancel request again to retry',
    });
  }
}

interface Progress {
  bookingsCancelled: number;
  holdsReleased: number;
  refundsIssued: number;
  refundedCents: number;
  passengersNotified: number;
  pending: FlightCancellationFailureDto[];
}
