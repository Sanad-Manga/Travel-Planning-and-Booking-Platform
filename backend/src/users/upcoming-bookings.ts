import { Injectable } from '@nestjs/common';
import { BookingType } from '../common';

/**
 * ACC-12: what the account-deactivation rule needs from the booking owners (Flights B, Hotels B).
 * Published here so both sides code against one signature; the booking owners implement it on their own
 * booking collection and register it (see UpcomingBookingsRegistry). Users never reads another module's schema.
 *
 * `hasUpcomingConfirmedBookings(userId, now)`: true if the user owns at least one booking of this owner's
 * type that is CONFIRMED and has not started yet:
 *   - flights: the (first) flight's `departureAt` is at or after `now` (a UTC instant);
 *   - hotels: the check-in date is on or after today's date (`now`, UTC, as YYYY-MM-DD).
 * Everything else does NOT block: PENDING_PAYMENT holds (unpaid, they expire on their own), CANCELLED,
 * EXPIRED, COMPLETED, and CONFIRMED bookings that already started or ended.
 * It must be a cheap indexed existence check (`exists`/`findOne`, never loading the bookings), and it must
 * throw on a database error instead of answering `false`: the deactivation then fails and nothing changes.
 */
export interface UpcomingBookingsChecker {
  hasUpcomingConfirmedBookings(userId: string, now: Date): Promise<boolean>;
}

/**
 * Booking owners register their checker once on module init, exactly like BookingProviderRegistry in payments:
 *   `registry.register(BookingType.FLIGHT, this)`.
 * A registry (not one injected token) because two owners must plug in and a provider overridden inside another
 * module is invisible to UsersModule. Until a type registers, it blocks nothing (known limit, see the docs).
 */
@Injectable()
export class UpcomingBookingsRegistry {
  private readonly checkers = new Map<BookingType, UpcomingBookingsChecker>();

  register(type: BookingType, checker: UpcomingBookingsChecker): void {
    this.checkers.set(type, checker);
  }

  registeredTypes(): BookingType[] {
    return [...this.checkers.keys()];
  }

  /** True if ANY registered owner reports an upcoming CONFIRMED booking. A failing checker rejects (fail closed). */
  async hasUpcomingConfirmedBookings(userId: string, now: Date): Promise<boolean> {
    const answers = await Promise.all([...this.checkers.values()].map((checker) => checker.hasUpcomingConfirmedBookings(userId, now)));
    return answers.some(Boolean);
  }
}
