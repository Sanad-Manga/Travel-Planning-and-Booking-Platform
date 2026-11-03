import { BookingStatus } from '../common';

export interface BookingStatusSnapshot {
  status: BookingStatus;
  /** Only set while the booking waits for payment. */
  holdExpiresAt?: Date | null;
}

/**
 * What BookingLifecycle needs from the flight and hotel booking owners (Flights B / Hotels B).
 *
 * `markExpired` is the existing method from docs/contracts.md section 7.
 * `getStatus`, `applyStatus` and `findExpiredHolds` are PROPOSED additions (SCRUM-33): the contract
 * has no way to persist a status change or to find expired holds. Pending the lead's confirmation.
 */
export interface BookingLifecycleProvider {
  /** Current status and hold expiry, or null if the booking does not exist. */
  getStatus(id: string): Promise<BookingStatusSnapshot | null>;

  /**
   * ONE atomic conditional update: set the status to `to` only if it is currently `from`
   * (e.g. findOneAndUpdate({ _id, status: from }, { status: to })).
   * Returns false when the booking was not in `from` any more (someone else changed it first).
   */
  applyStatus(
    id: string,
    from: BookingStatus,
    to: BookingStatus,
  ): Promise<boolean>;

  /** Ids of PENDING_PAYMENT bookings whose holdExpiresAt is at or before `now`, at most `limit`. */
  findExpiredHolds(now: Date, limit: number): Promise<string[]>;

  /** Release the held seats / rooms (contract method). Called once after a booking becomes EXPIRED. */
  markExpired(id: string): Promise<void>;
}
