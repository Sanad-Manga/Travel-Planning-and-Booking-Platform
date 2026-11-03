import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingStatus, BookingType } from '../common';
import { BookingProviderRegistry } from './booking-provider.registry';
import { isAllowedTransition } from './booking-transitions';

/** How many expired holds the sweep loads from one provider at a time. */
export const HOLD_SWEEP_BATCH_SIZE = 100;

/**
 * Owns every booking status change (GEN-11). Booking owners never set `status` themselves:
 * they call `transition()`, and read paths call `expireIfDue()` (the lazy expiry check).
 */
@Injectable()
export class BookingLifecycle {
  private readonly logger = new Logger(BookingLifecycle.name);
  private sweeping = false;

  constructor(private readonly providers: BookingProviderRegistry) {}

  /**
   * Move a booking to `to`. 404 if it does not exist, 409 if the move is not allowed or the booking
   * changed while we were working. The validation read is only a check: the write itself is one
   * atomic "set to `to` only if still `from`", so two callers can never both win.
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

    if (to === BookingStatus.EXPIRED) {
      // The status is already final. A failed release must not undo it or break the caller:
      // availability is total - booked - unexpired holds, so an expired hold stops counting anyway.
      try {
        await provider.markExpired(bookingId);
      } catch (error) {
        this.logger.error(
          `Booking ${type}:${bookingId} is EXPIRED but releasing it failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /**
   * Lazy expiry: call this whenever a booking is read. If it is still PENDING_PAYMENT and its hold has
   * run out, expire it now. Returns true only when this call expired it.
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

    try {
      await this.transition(type, bookingId, BookingStatus.EXPIRED);
      return true;
    } catch (error) {
      // Paid or expired by someone else between our read and write: nothing left to do.
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      )
        return false;
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleHoldExpirySweep(): Promise<void> {
    await this.sweepExpiredHolds();
  }

  /** Expire every due hold for all registered booking types. Safe to run twice: it is idempotent. */
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

    for (;;) {
      const ids = await provider.findExpiredHolds(now, HOLD_SWEEP_BATCH_SIZE);
      let handled = 0;

      for (const id of ids) {
        try {
          await this.transition(type, id, BookingStatus.EXPIRED);
          expired++;
          handled++;
        } catch (error) {
          if (
            error instanceof ConflictException ||
            error instanceof NotFoundException
          ) {
            handled++; // paid, cancelled or gone meanwhile: it will not show up in the next batch
          } else {
            this.logger.error(
              `Could not expire ${type} booking ${id}`,
              error instanceof Error ? error.stack : String(error),
            );
          }
        }
      }

      // Another batch only if this one was full and moved forward (never loop on bookings that keep failing).
      if (ids.length < HOLD_SWEEP_BATCH_SIZE || handled === 0) return expired;
    }
  }
}
