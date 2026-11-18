import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, BookingStatus, BookingType } from '../common';
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
  ) {}

  /** What cancelling would refund right now. Changes nothing. */
  async preview(user: AuthenticatedUser, id: string, now: Date = new Date()): Promise<HotelCancellationPreviewDto> {
    return this.plan(user, id, now);
  }

  /**
   * Cancel the reservation and refund it. Not the owner's or an unknown reservation is a 404; one that is not
   * CONFIRMED, or whose check-in moment has passed, is a 409. The status change is one atomic write, so two
   * simultaneous cancellations cannot both win and the refund is issued by the winner only. When no tier applies the
   * refund is 0, nothing is sent to Stripe and `refund` is null.
   */
  async cancel(user: AuthenticatedUser, id: string, now: Date = new Date()): Promise<HotelCancellationResultDto> {
    const plan = await this.plan(user, id, now);

    // 409 if another request changed the reservation since the check above; nothing is refunded then.
    await this.bookingLifecycle.transition(BookingType.HOTEL, id, BookingStatus.CANCELLED);

    let refund: HotelCancellationResultDto['refund'] = null;
    if (plan.refundCents > 0) {
      try {
        const issued = await this.refunds.issue({
          bookingType: BookingType.HOTEL,
          bookingId: id,
          amountCents: plan.refundCents,
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
        // The reservation is already CANCELLED and its rooms are free; the refund is what is missing, so say so loudly.
        this.logger.error(
          `Hotel reservation ${id} was cancelled but its refund of ${plan.refundCents} cents could not be issued`,
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      }
    }

    const cancelled = await this.bookings.findById(id).lean<HotelBookingLean>().exec();
    if (!cancelled) throw new NotFoundException('Hotel booking not found');
    return { booking: HotelBookingResponseDto.from(cancelled), refund };
  }

  private async plan(user: AuthenticatedUser, id: string, now: Date): Promise<HotelCancellationPreviewDto> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Hotel booking not found');
    const booking = await this.bookings
      .findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(user.userId) })
      .lean<HotelBookingLean>()
      .exec();
    if (!booking) throw new NotFoundException('Hotel booking not found');

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
      bookingId: id,
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
