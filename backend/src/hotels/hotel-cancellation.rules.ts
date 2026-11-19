const DAY_MS = 86_400_000;

/**
 * HTL-21: the UTC moment a stay starts, the check-in date at the hotel's check-in time (HTL-09).
 * A hotel that never set a time counts from the start of the check-in day, so the traveler cannot cancel on the
 * check-in day itself: the later moment would be a guess, and the earlier one never refunds more than it should.
 */
export function checkInInstant(checkIn: string, checkInTime: string | null): Date {
  return new Date(`${checkIn}T${checkInTime ?? '00:00'}:00.000Z`);
}

/** Days from `now` to `instant`, fractional (the unit `RefundCalculator` takes). Zero at the instant, negative after it. */
export function daysUntil(instant: Date, now: Date): number {
  return (instant.getTime() - now.getTime()) / DAY_MS;
}
