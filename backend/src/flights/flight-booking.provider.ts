import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Connection, Model, Types } from 'mongoose';
import { BookingStatus, BookingType, NotificationType } from '../common';
import { AirlinesService } from '../airlines';
import { FlightInventoryService } from './flight-inventory.service';
import { NotificationsService } from '../notifications';
import {
  BookingPolicies,
  BookingProvider,
  BookingStatusSnapshot,
} from '../payments/booking-provider.interface';
import { BookingProviderRegistry } from '../payments/booking-provider.registry';
import {
  FlightBooking,
  FlightBookingLean,
  getFlightBookingSegments,
} from './schemas/flight-booking.schema';

export interface FlightPayable {
  amountCents: number;
  currency: string;
  status: BookingStatus;
  holdExpiresAt: Date | null;
}

/** How many times a confirmation is retried when the generated reference collides. */
const BOOKING_REFERENCE_ATTEMPTS = 5;
const DUPLICATE_KEY_CODE = 11000;

/**
 * FLT-23: an opaque, upper-case flight booking reference. Uniqueness is guaranteed by the
 * sparse unique index on `bookingReference`, not by reading first (another confirmation can
 * be generating one at the same moment).
 */
export function generateBookingReference(): string {
  return `FLT-${randomBytes(8).toString('hex').toUpperCase()}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { code?: unknown }).code === DUPLICATE_KEY_CODE ||
      (error instanceof Error && error.message.includes('E11000')))
  );
}

type ConfirmationOutcome = {
  kind: 'CONFIRMED_NOW' | 'ALREADY' | 'REFUSED';
  booking: FlightBookingLean | null;
};

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
    private readonly airlines: AirlinesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(BookingType.FLIGHT, this);
  }

  /** FLT-21/PAY-01: expose the stored booking total through the documented payable shape. */
  async getPayable(id: string, userId: string): Promise<FlightPayable | null> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      return null;
    }
    const booking = await this.model
      .findOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      })
      .select('totalCents currency status holdExpiresAt')
      .lean<
        Pick<
          FlightBookingLean,
          'totalCents' | 'currency' | 'status' | 'holdExpiresAt'
        >
      >()
      .exec();
    if (!booking) return null;
    return {
      amountCents: booking.totalCents,
      currency: booking.currency,
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt ?? null,
    };
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

      if (
        to === BookingStatus.EXPIRED ||
        to === BookingStatus.CANCELLED
      ) {
        for (const segment of getFlightBookingSegments(before)) {
          if (to === BookingStatus.EXPIRED) {
            await this.inventory.releaseHeldSeats(
              segment.flightId,
              segment.cabinClass,
              segment.seats,
              session,
            );
          } else {
            await this.inventory.returnBookedSeats(
              segment.flightId,
              segment.cabinClass,
              segment.seats,
              session,
            );
          }
        }
      }
      applied = true;
    });
    return applied;
  }

  /**
   * Payment succeeded: PENDING_PAYMENT -> CONFIRMED with the payment reference and a unique booking
   * reference, held seats become booked seats, all in one transaction (FLT-23). Idempotent:
   * confirming an already confirmed booking with the SAME reference is a successful no-op (the
   * webhook and the late-paid expiry path can both arrive) and never changes the reference, the
   * inventory or the notification count. A different payment reference never reconfirms it.
   * False if the booking does not exist or is no longer waiting for payment.
   */
  async markConfirmed(id: string, paymentRef: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;

    const outcome = await this.confirmWithUniqueReference(id, paymentRef);

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

  /**
   * One transaction confirms the booking and assigns its reference. If the sparse unique index
   * rejects a freshly generated reference, the whole transaction rolls back and a new reference is
   * tried, so a collision can never leave a booking confirmed without its seat conversion.
   */
  private async confirmWithUniqueReference(
    id: string,
    paymentRef: string,
  ): Promise<ConfirmationOutcome> {
    for (let attempt = 1; ; attempt++) {
      // A holder object (not loose variables) because the callback below may run more than once.
      const outcome: ConfirmationOutcome = { kind: 'REFUSED', booking: null };
      try {
        await this.connection.transaction(async (session) => {
          outcome.kind = 'REFUSED';
          outcome.booking = null;
          const before = await this.model
            .findOneAndUpdate(
              { _id: id, status: BookingStatus.PENDING_PAYMENT },
              {
                $set: {
                  status: BookingStatus.CONFIRMED,
                  paymentRef,
                  bookingReference: generateBookingReference(),
                },
                $unset: { holdExpiresAt: '' },
              },
              { session },
            )
            .lean<FlightBookingLean>()
            .exec();

          if (before) {
            for (const segment of getFlightBookingSegments(before)) {
              await this.inventory.confirmHeldSeats(
                segment.flightId,
                segment.cabinClass,
                segment.seats,
                session,
              );
            }
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
        return outcome;
      } catch (error) {
        if (
          !isDuplicateKeyError(error) ||
          attempt >= BOOKING_REFERENCE_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
  }

  /**
   * PAY-02: this booking's owner plus its airline's cancellation tiers and baggage policy,
   * fetched through Airlines' own exported getters (FLT-09/FLT-08) — Payments never reads
   * airline data directly.
   */
  async getPolicies(id: string): Promise<BookingPolicies | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const booking = await this.model
      .findById(id)
      .select('userId airlineId')
      .lean<Pick<FlightBookingLean, 'userId' | 'airlineId'>>()
      .exec();
    if (!booking) return null;

    const airlineId = booking.airlineId.toString();
    const [cancellationTiers, baggagePolicy] = await Promise.all([
      this.airlines.getCancellationTiers(airlineId),
      this.airlines.getBaggagePolicy(airlineId),
    ]);
    return {
      ownerId: booking.userId.toString(),
      cancellationTiers,
      baggagePolicy,
    };
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
