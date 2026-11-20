import { FilterQuery } from 'mongoose';
import { BookingStatus } from '../common';
import { todayUtc } from './hotel-availability.rules';
import { HotelBooking } from './schemas/hotel-booking.schema';

/**
 * The three groups of "My hotel reservations" (HTL-20). Every reservation belongs to exactly one:
 *
 * - UPCOMING: a CONFIRMED stay that is not over (check-out is after today, so a stay in progress is still here),
 *   or a PENDING_PAYMENT reservation whose hold is still live and can be paid.
 * - PAST: a COMPLETED stay, or a CONFIRMED stay whose check-out day is today or earlier (the check-out day is not
 *   a night). BookingLifecycle may not have marked it COMPLETED yet, so the date decides, not only the status.
 * - CANCELLED: a CANCELLED reservation, an EXPIRED one, and a PENDING_PAYMENT one whose hold has lapsed but that
 *   BookingLifecycle has not swept yet (it can no longer be paid). A hold that ends exactly now is lapsed.
 *
 * Dates are UTC (docs/contracts.md section 3).
 */
export enum HotelBookingGroup {
  UPCOMING = 'UPCOMING',
  PAST = 'PAST',
  CANCELLED = 'CANCELLED',
}

/** The fields of a reservation the group depends on. */
export interface GroupableBooking {
  status: BookingStatus;
  checkOut: string;
  holdExpiresAt?: Date | null;
}

const holdIsLive = (booking: GroupableBooking, now: Date): boolean =>
  !!booking.holdExpiresAt && booking.holdExpiresAt.getTime() > now.getTime();

/** The group of one reservation. Keep it in step with {@link groupFilter}, which asks Mongo for the same thing. */
export function groupOf(
  booking: GroupableBooking,
  now: Date = new Date(),
): HotelBookingGroup {
  switch (booking.status) {
    case BookingStatus.CONFIRMED:
      return booking.checkOut > todayUtc(now)
        ? HotelBookingGroup.UPCOMING
        : HotelBookingGroup.PAST;
    case BookingStatus.COMPLETED:
      return HotelBookingGroup.PAST;
    case BookingStatus.PENDING_PAYMENT:
      return holdIsLive(booking, now)
        ? HotelBookingGroup.UPCOMING
        : HotelBookingGroup.CANCELLED;
    default:
      return HotelBookingGroup.CANCELLED;
  }
}

/** The Mongo filter of a group: the same rules as {@link groupOf}, so a list page and a row never disagree. */
export function groupFilter(
  group: HotelBookingGroup,
  now: Date = new Date(),
): FilterQuery<HotelBooking> {
  const today = todayUtc(now);
  switch (group) {
    case HotelBookingGroup.UPCOMING:
      return {
        $or: [
          { status: BookingStatus.CONFIRMED, checkOut: { $gt: today } },
          {
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $gt: now },
          },
        ],
      };
    case HotelBookingGroup.PAST:
      return {
        $or: [
          { status: BookingStatus.COMPLETED },
          { status: BookingStatus.CONFIRMED, checkOut: { $lte: today } },
        ],
      };
    case HotelBookingGroup.CANCELLED:
      return {
        $or: [
          { status: { $in: [BookingStatus.CANCELLED, BookingStatus.EXPIRED] } },
          {
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $not: { $gt: now } },
          },
        ],
      };
  }
}

/**
 * Sort of a list page. What the traveler needs first comes first: the next stay, the latest past stay, the most
 * recently cancelled one. `_id` keeps pages stable when the dates are equal. Without a group: newest reservation first.
 */
export function groupSort(group?: HotelBookingGroup): Record<string, 1 | -1> {
  switch (group) {
    case HotelBookingGroup.UPCOMING:
      return { checkIn: 1, _id: 1 };
    case HotelBookingGroup.PAST:
      return { checkOut: -1, _id: -1 };
    case HotelBookingGroup.CANCELLED:
      return { updatedAt: -1, _id: -1 };
    default:
      return { createdAt: -1, _id: -1 };
  }
}
