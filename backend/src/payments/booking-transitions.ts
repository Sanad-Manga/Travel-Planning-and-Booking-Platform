import { BookingStatus } from '../common';

/**
 * The only legal booking status moves (docs/contracts.md section 5):
 * PENDING_PAYMENT -> CONFIRMED -> COMPLETED, PENDING_PAYMENT -> EXPIRED, CONFIRMED -> CANCELLED.
 * COMPLETED, EXPIRED and CANCELLED are final. Anything not listed here is rejected.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = {
  [BookingStatus.PENDING_PAYMENT]: [
    BookingStatus.CONFIRMED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.EXPIRED]: [],
  [BookingStatus.CANCELLED]: [],
};

export function isAllowedTransition(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
