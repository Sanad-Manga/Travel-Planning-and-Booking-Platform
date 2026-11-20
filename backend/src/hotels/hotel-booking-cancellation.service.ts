import { ConflictException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, BookingStatus, BookingType, NotificationType } from '../common';
import { NotificationsService } from '../notifications';
import { BookingLifecycle, RefundCalculator } from '../payments';
import { RefundsService } from '../refunds';
import { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { HotelCancellationPreviewDto, HotelCancellationResultDto } from './dto/hotel-cancellation.dto';
import { checkInInstant, daysUntil } from './hotel-cancellation.rules';
import { HotelsService } from './hotels.service';
import { HotelBooking, HotelBookingLean } from './schemas/hotel-booking.schema';

/**
 * HTL-21: the traveler cancels a whole CONFIRMED reservation before check-in. The refund is the hotel's tier
 * percentage (HTL-10) of the full total, worked out by Payments' `RefundCalculator`; the status change goes through
 * `BookingLifecycle` (which frees the rooms in the same write) and the money through `RefundsService.issue` (PAY-03).
 * There is no partial cancellation: a reservation is cancelled as a whole or not at all.
 */
@Injectable()
export class HotelBookingCancellationService {
  private readonly logger = new Logger(HotelBookingCancellationService.name);

  constructor(
    @InjectModel(HotelBooking.name) private readonly bookings: Model<HotelBooking>,
    private readonly hotelsService: HotelsService,
    private readonly bookingLifecycle: BookingLifecycle,
    private readonly refunds: RefundsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** What cancelling would refund right now. Changes nothing. */
  async preview(user: AuthenticatedUser, id: string, now: Date = new Date()): Promise<HotelCancellationPreviewDto> {
    return this.plan(await this.loadOwned(user, id), now);
  }

  /**
   * Cancel the reservation and refund it. Not the owner's or an unknown reservation is a 404; one that is not
   * CONFIRMED, or whose check-in moment has passed, is a 409. The status change is one atomic write, so two
   * simultaneous cancellations cannot both win and the refund is issued by the winner only. When no tier applies the
   * refund is 0, nothing is sent to Stripe and `refund` is null.
   *
   * What the cancellation refunds is recorded on the reservation just before its status changes. If the refund call then
   * fails, the reservation stays CANCELLED (its rooms are free) and the answer is 503; cancelling again completes the
   * refund with the recorded amount, whatever the tier would be by then.
   */
  async cancel(user: AuthenticatedUser, id: string, now: Date = new Date()): Promise<HotelCancellationResultDto> {
    const booking = await this.loadOwned(user, id);
    if (booking.status === BookingStatus.CANCELLED) return this.completeRefund(booking);

    const plan = await this.plan(booking, now);

    // Only while the reservation is still CONFIRMED: if another request got there first, nothing is recorded or refunded.
    const recorded = await this.bookings
      .updateOne(
        { _id: booking._id, userId: booking.userId, status: BookingStatus.CONFIRMED },
        { $set: { cancellationRequestedAt: now, cancellationRefundCents: plan.refundCents } },
      )
      .exec();
    if (recorded.matchedCount !== 1) throw new ConflictException('The reservation was changed by another request; nothing was cancelled');

    // 409 if another request changed the reservation since the write above.
    await this.bookingLifecycle.transition(BookingType.HOTEL, id, BookingStatus.CANCELLED);
    await this.notifyCancelled(booking);
    return this.refund(id, plan.refundCents);
  }

  /**
   * GEN-01: a distinct cancellation notice, separate from the refund notification (RefundsService
   * fires that, and only when the refund is positive — a 0% tier would otherwise notify nothing).
   * `NotificationsService.notify` already swallows its own failures, so a notification problem
   * never blocks the cancellation.
   */
  private async notifyCancelled(booking: HotelBookingLean): Promise<void> {
    await this.notifications.notify({
      userId: booking.userId.toString(),
      type: NotificationType.BOOKING_CANCELLED,
      title: 'Hotel reservation cancelled',
      message: booking.bookingReference
        ? `Your hotel reservation ${booking.bookingReference} has been cancelled.`
        : 'Your hotel reservation has been cancelled.',
      link: `/hotel-bookings/${booking._id.toString()}`,
    });
  }

  /** The reservation is already CANCELLED: issue the refund its cancellation recorded, if it has not been issued yet. */
  private async completeRefund(booking: HotelBookingLean): Promise<HotelCancellationResultDto> {
    const recorded = booking.cancellationRefundCents ?? 0;
    if (recorded <= 0) {
      throw new ConflictException(`Only a CONFIRMED reservation can be cancelled; this one is ${booking.status}`);
    }
    if (await this.refunds.getLatestForBooking(BookingType.HOTEL, booking._id.toString())) {
      throw new ConflictException('This reservation is already cancelled and its refund was issued');
    }
    return this.refund(booking._id.toString(), recorded);
  }

  /** Issues the refund (nothing when it is 0) and answers with the reservation as it is now. */
  private async refund(id: string, refundCents: number): Promise<HotelCancellationResultDto> {
    let refund: HotelCancellationResultDto['refund'] = null;
    if (refundCents > 0) {
      try {
        const issued = await this.refunds.issue({
          bookingType: BookingType.HOTEL,
          bookingId: id,
          amountCents: refundCents,
          reason: 'Hotel reservation cancelled by the traveler',
        });
        refund = {
          id: issued.id,
          bookingType: issued.bookingType,
          bookingId: issued.bookingId,
          status: issued.status,
          amountCents: issued.amountCents,
          currency: issued.currency,
          createdAt: issued.createdAt,
        };
      } catch (error) {
        // A refusal by the refund rules (409, 400) is the answer as it is; anything else (Stripe down, a network error) is
        // transient: the reservation is already CANCELLED, so say that and how to finish the refund.
        if (error instanceof HttpException) throw error;
        this.logger.error(
          `Hotel reservation ${id} was cancelled but its refund of ${refundCents} cents could not be issued`,
          error instanceof Error ? error.stack : String(error),
        );
        throw new ServiceUnavailableException(
          'The reservation is cancelled and its rooms are released, but the refund could not be issued yet. Send the cancel request again to retry the refund.',
        );
      }
    }

    const cancelled = await this.bookings.findById(id).lean<HotelBookingLean>().exec();
    if (!cancelled) throw new NotFoundException('Hotel booking not found');
    return { booking: HotelBookingResponseDto.from(cancelled), refund };
  }

  /** The caller's own reservation: 404 for someone else's, an unknown and a malformed id. */
  private async loadOwned(user: AuthenticatedUser, id: string): Promise<HotelBookingLean> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Hotel booking not found');
    const booking = await this.bookings
      .findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(user.userId) })
      .lean<HotelBookingLean>()
      .exec();
    if (!booking) throw new NotFoundException('Hotel booking not found');
    return booking;
  }

  private async plan(booking: HotelBookingLean, now: Date): Promise<HotelCancellationPreviewDto> {
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(`Only a CONFIRMED reservation can be cancelled; this one is ${booking.status}`);
    }

    const policies = await this.hotelsService.getPolicies(booking.hotelId.toString());
    const startsAt = checkInInstant(booking.checkIn, policies.checkInTime);
    const daysBeforeCheckIn = daysUntil(startsAt, now);
    if (daysBeforeCheckIn <= 0) {
      throw new ConflictException('A reservation can only be cancelled before check-in; the check-in time has passed');
    }

    const refundCents = RefundCalculator.compute({
      tiers: policies.cancellationTiers,
      daysBefore: daysBeforeCheckIn,
      totalCents: booking.totalCents,
    });
    return {
      bookingId: booking._id.toString(),
      checkIn: booking.checkIn,
      checkInAt: startsAt.toISOString(),
      daysBeforeCheckIn,
      totalCents: booking.totalCents,
      currency: booking.currency,
      refundCents,
      nonRefundableCents: booking.totalCents - refundCents,
    };
  }
}
