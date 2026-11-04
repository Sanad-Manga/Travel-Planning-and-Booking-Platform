import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingStatus, BookingType } from '../common';
import { BookingProviderRegistry } from './booking-provider.registry';
import { isAllowedTransition } from './booking-transitions';
import { PAYMENT_ACTIVITY, PaymentActivity } from './payment-activity';

/** How many expired holds the sweep loads from one provider at a time. */
export const HOLD_SWEEP_BATCH_SIZE = 100;

/** What happened to a PENDING_PAYMENT booking whose hold had run out. */
type DueOutcome = 'skipped' | 'expired' | 'confirmed';

/**
 * Owns every booking status change (GEN-11). Booking owners never set `status` themselves:
 * they call `transition()`, and read paths call `expireIfDue()` (the lazy expiry check).
 */
@Injectable()
export class BookingLifecycle {
  private readonly logger = new Logger(BookingLifecycle.name);
  private sweeping = false;

  constructor(
    private readonly providers: BookingProviderRegistry,
    @Inject(PAYMENT_ACTIVITY) private readonly paymentActivity: PaymentActivity,
  ) {}

  /**
   * Move a booking to `to`. 404 if it does not exist, 409 if the move is not allowed or the booking
   * changed while we were working. The validation read is only a check: the write itself is one
   * atomic "set to `to` only if still `from`" (which also releases inventory when `to` is EXPIRED
   * or CANCELLED, in the same transaction), so two callers can never both win and never leave a
   * status change without its release or vice versa.
   */
  async transition(
    type: BookingType,
    bookingId: string,
    to: BookingStatus,
  ): Promise<void> {
    const provider = this.providers.get(type);

    const current = await provider.getStatus(bookingId);
    if (!current) throw new NotFoundException(`${type} booking not found`);

    const from = current.status;
    if (!isAllowedTransition(from, to)) {
      throw new ConflictException(
        `Cannot change a booking from ${from} to ${to}`,
      );
    }

    const applied = await provider.applyStatus(bookingId, from, to);
    if (!applied) {
      throw new ConflictException(
        `Booking is no longer ${from}; it was changed by another request`,
      );
    }
  }

  /**
   * A PENDING_PAYMENT booking's hold has run out: decide what happens to it via PaymentActivity
   * rather than expiring unconditionally, since a payment may be in flight and protected by the
   * pause (see payment-activity.ts). Shared by the lazy check and the sweep.
   */
  private async settleDueBooking(
    type: BookingType,
    bookingId: string,
    now: Date,
  ): Promise<DueOutcome> {
    const result = await this.paymentActivity.prepareExpiry(type, bookingId, now);
    if (result === 'SKIP') return 'skipped';

    const to = result === 'PAID' ? BookingStatus.CONFIRMED : BookingStatus.EXPIRED;
    try {
      await this.transition(type, bookingId, to);
      return result === 'PAID' ? 'confirmed' : 'expired';
    } catch (error) {
      // Already moved or gone by the time we tried to write: nothing left to do here.
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        return 'skipped';
      }
      throw error;
    }
  }

  /**
   * Lazy expiry: call this whenever a booking is read. If it is still PENDING_PAYMENT and its hold
   * has run out, resolve it now (expire, or confirm if PaymentActivity reports the payment already
   * succeeded). Returns true only when this call resolved it one way or the other.
   */
  async expireIfDue(
    type: BookingType,
    bookingId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const snapshot = await this.providers.get(type).getStatus(bookingId);
    if (
      !snapshot ||
      snapshot.status !== BookingStatus.PENDING_PAYMENT ||
      !snapshot.holdExpiresAt ||
      snapshot.holdExpiresAt.getTime() > now.getTime()
    ) {
      return false;
    }

    const outcome = await this.settleDueBooking(type, bookingId, now);
    return outcome !== 'skipped';
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleHoldExpirySweep(): Promise<void> {
    await this.sweepExpiredHolds();
  }

  /** Expire or confirm every due hold for all registered booking types. Safe to run twice: it is idempotent. */
  async sweepExpiredHolds(now: Date = new Date()): Promise<number> {
    if (this.sweeping) return 0; // a slow run is still going; skip instead of overlapping
    this.sweeping = true;
    let expired = 0;
    try {
      for (const type of this.providers.registeredTypes()) {
        try {
          expired += await this.sweepType(type, now);
        } catch (error) {
          this.logger.error(
            `Hold-expiry sweep failed for ${type}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } finally {
      this.sweeping = false;
    }
    return expired;
  }

  private async sweepType(type: BookingType, now: Date): Promise<number> {
    const provider = this.providers.get(type);
    let expired = 0;
    let afterId: string | undefined;

    for (;;) {
      const ids = await provider.findExpiredHolds(
        now,
        HOLD_SWEEP_BATCH_SIZE,
        afterId,
      );
      if (ids.length === 0) return expired;

      for (const id of ids) {
        try {
          const outcome = await this.settleDueBooking(type, id, now);
          if (outcome === 'expired') expired++;
        } catch (error) {
          this.logger.error(
            `Could not resolve ${type} booking ${id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
        // Advance the cursor past this id regardless of outcome (skipped, confirmed, expired,
        // or errored) so a booking that keeps getting skipped or keeps failing can never cause
        // the same page to be re-fetched forever, and never blocks bookings further down the list.
        afterId = id;
      }

      if (ids.length < HOLD_SWEEP_BATCH_SIZE) return expired;
    }
  }
}
