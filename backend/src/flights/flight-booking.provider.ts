import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { BookingStatus, BookingType, NotificationType } from '../common';
import { FlightInventoryService } from './flight-inventory.service';
import { NotificationsService } from '../notifications';
import {
  BookingProvider,
  BookingStatusSnapshot,
} from '../payments/booking-provider.interface';
import { BookingProviderRegistry } from '../payments/booking-provider.registry';
import {
  FlightBooking,
  FlightBookingLean,
} from './schemas/flight-booking.schema';

/**
 * Flights B's side of the booking-provider contract (docs/contracts.md section 7): what BookingLifecycle,
 * the hold-expiry sweep and Payments call. Every seat change happens in the same MongoDB transaction as
 * the status change, so a booking and its seat counters can never disagree.
 */
@Injectable()
export class FlightBookingProvider implements BookingProvider, OnModuleInit {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly model: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: FlightInventoryService,
    private readonly notifications: NotificationsService,
    private readonly registry: BookingProviderRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(BookingType.FLIGHT, this);
  }

  async getStatus(id: string): Promise<BookingStatusSnapshot | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const booking = await this.model
      .findById(id)
      .select('status holdExpiresAt')
      .lean<Pick<FlightBookingLean, 'status' | 'holdExpiresAt'>>()
      .exec();
    if (!booking) return null;
    return {
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt ?? null,
    };
  }

  /**
   * Set the status to `to` only if it is still `from`, and give the seats back in the SAME transaction:
   * EXPIRED returns held seats, CANCELLED returns booked seats. Returns false if the booking changed first.
   */
  async applyStatus(
    id: string,
    from: BookingStatus,
    to: BookingStatus,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;

    let applied = false;
    await this.connection.transaction(async (session) => {
      applied = false; // a retried transaction starts again from scratch
      // Without { new: true } this returns the booking as it was just before the update.
      const before = await this.model
        .findOneAndUpdate(
          { _id: id, status: from },
          { $set: { status: to }, $unset: { holdExpiresAt: '' } },
          { session },
        )
        .lean<FlightBookingLean>()
        .exec();
      if (!before) return;

      if (to === BookingStatus.EXPIRED) {
        await this.inventory.releaseHeldSeats(
          before.flightId,
          before.cabinClass,
          before.seats,
          session,
        );
      } else if (to === BookingStatus.CANCELLED) {
        await this.inventory.returnBookedSeats(
          before.flightId,
          before.cabinClass,
          before.seats,
          session,
        );
      }
      applied = true;
    });
    return applied;
  }

  /**
   * Payment succeeded: PENDING_PAYMENT -> CONFIRMED with the payment reference, held seats become booked seats,
   * all in one transaction. Idempotent: confirming an already confirmed booking with the SAME reference is a
   * successful no-op (the webhook and the late-paid expiry path can both arrive). False if the booking does not
   * exist or is no longer waiting for payment.
   */
  async markConfirmed(id: string, paymentRef: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;

    // A holder object (not loose variables) because the callback below may run more than once.
    const outcome: {
      kind: 'CONFIRMED_NOW' | 'ALREADY' | 'REFUSED';
      booking: FlightBookingLean | null;
    } = { kind: 'REFUSED', booking: null };
    await this.connection.transaction(async (session) => {
      outcome.kind = 'REFUSED';
      outcome.booking = null;
      const before = await this.model
        .findOneAndUpdate(
          { _id: id, status: BookingStatus.PENDING_PAYMENT },
          {
            $set: { status: BookingStatus.CONFIRMED, paymentRef },
            $unset: { holdExpiresAt: '' },
          },
          { session },
        )
        .lean<FlightBookingLean>()
        .exec();

      if (before) {
        await this.inventory.confirmHeldSeats(
          before.flightId,
          before.cabinClass,
          before.seats,
          session,
        );
        outcome.booking = before;
        outcome.kind = 'CONFIRMED_NOW';
        return;
      }

      const existing = await this.model
        .findById(id)
        .session(session)
        .select('status paymentRef')
        .lean<Pick<FlightBookingLean, 'status' | 'paymentRef'>>()
        .exec();
      if (
        existing?.status === BookingStatus.CONFIRMED &&
        existing.paymentRef === paymentRef
      ) {
        outcome.kind = 'ALREADY';
      }
    });

    if (outcome.kind === 'CONFIRMED_NOW' && outcome.booking) {
      // After the commit, and never throws: telling the traveler must not undo a confirmed booking.
      await this.notifications.notify({
        userId: outcome.booking.userId.toString(),
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Flight booking confirmed',
        message:
          'Your payment was received and your flight booking is confirmed.',
        link: `/flight-bookings/${id}`,
      });
    }
    return outcome.kind !== 'REFUSED';
  }

  async findExpiredHolds(
    now: Date,
    limit: number,
    afterId?: string,
  ): Promise<string[]> {
    if (afterId !== undefined && !Types.ObjectId.isValid(afterId)) return [];
    const rows = await this.model
      .find({
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: now },
        ...(afterId ? { _id: { $gt: new Types.ObjectId(afterId) } } : {}),
      })
      .sort({ _id: 1 })
      .limit(limit)
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return rows.map((row) => row._id.toString());
  }
}
