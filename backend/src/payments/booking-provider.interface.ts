import { BookingStatus } from '../common';

export interface BookingStatusSnapshot {
  status: BookingStatus;
  /** Only set while the booking waits for payment. */
  holdExpiresAt?: Date | null;
}

/**
 * Everything BookingLifecycle needs from a booking owner (Flights B / Hotels B).
 * Confirmed by the lead for SCRUM-33 — docs/contracts.md section 7, to be recorded as v1.1.
 * (Previously drafted under the name `BookingLifecycleProvider`; this is the single,
 * merged name going forward.)
 */
export interface BookingProvider {
  /** Current status and hold expiry, or null if the booking does not exist. */
  getStatus(id: string): Promise<BookingStatusSnapshot | null>;

  /**
   * ONE atomic conditional update: set the status to `to` only if it is currently `from`
   * (e.g. findOneAndUpdate({ _id, status: from }, { status: to })).
   * Returns false when the booking was not in `from` any more (someone else changed it first).
   *
   * When `to` is EXPIRED or CANCELLED, the held seats/rooms are released in the SAME
   * MongoDB transaction as the status write — there is no separate best-effort release
   * step any more (no `markExpired`). If the transaction fails, neither the status nor
   * the release happened.
   */
  applyStatus(
    id: string,
    from: BookingStatus,
    to: BookingStatus,
  ): Promise<boolean>;

  /**
   * Ids of PENDING_PAYMENT bookings whose holdExpiresAt is at or before `now`, ordered so a
   * cursor makes sense (e.g. ascending by _id), starting strictly after `afterId` when given,
   * at most `limit`.
   */
  findExpiredHolds(
    now: Date,
    limit: number,
    afterId?: string,
  ): Promise<string[]>;
}
