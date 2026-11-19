/** Pure rules of the room-status view (HTL-08). No database: unit tested on their own. */
import { DateRange } from './hotel-availability.rules';

export enum RoomDateStatus {
  AVAILABLE = 'AVAILABLE',
  BOOKED = 'BOOKED',
  BLOCKED = 'BLOCKED',
}

/** Why a date is BLOCKED (not sellable although nobody booked it). */
export enum RoomBlockedReason {
  /** The room is taken out of sale (HTL-06 deactivate). */
  ROOM_DEACTIVATED = 'ROOM_DEACTIVATED',
  /** The moderator blocked this date range (HTL-06). */
  BLOCKED_RANGE = 'BLOCKED_RANGE',
  /** No availability range (HTL-04) covers the date, so the room is not offered for it. */
  NOT_OFFERED = 'NOT_OFFERED',
}

/** A reservation slice that claims a room: stay [checkIn, checkOut) (YYYY-MM-DD, checkOut is not a night). */
export interface RoomReservationSlice {
  id: string;
  reference: string | null;
  status: string;
  checkIn: string;
  checkOut: string;
}

export interface RoomDayInput {
  isActive: boolean;
  availability: DateRange[];
  blockedRanges: DateRange[];
  reservations: RoomReservationSlice[];
}

export interface RoomDay {
  date: string;
  status: RoomDateStatus;
  reservation?: RoomReservationSlice;
  blockedReason?: RoomBlockedReason;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const toUtcDay = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);
const fromUtcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The day after `date` (YYYY-MM-DD, UTC). */
export function nextDay(date: string): string {
  return fromUtcDay(toUtcDay(date) + DAY_MS);
}

/** Number of calendar days from `from` to `to`, both included. 0 or less when `to` is before `from`. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((toUtcDay(to) - toUtcDay(from)) / DAY_MS) + 1;
}

/** Every date from `from` to `to`, both included, ascending. */
export function listDates(from: string, to: string): string[] {
  return Array.from({ length: Math.max(0, inclusiveDays(from, to)) }, (_, i) => fromUtcDay(toUtcDay(from) + i * DAY_MS));
}

const inRange = (ranges: DateRange[], date: string): boolean => ranges.some((r) => r.startDate <= date && date < r.endDate);

/**
 * Exactly ONE status per date (the function returns one entry per date, never two):
 *  1. BOOKED  - a reservation covers the night (checkIn <= date < checkOut). It wins over everything else: a stay that
 *               already exists is never hidden by a block set later. Its reference travels with the day.
 *  2. BLOCKED - not sellable, with the reason: room deactivated, date inside a blocked range, or no availability
 *               range offers the date.
 *  3. AVAILABLE - the room is active, offered for the date, not blocked and not reserved.
 * If two reservations ever overlapped on one night (should not happen) the CONFIRMED one is shown, then the earliest check-in.
 */
export function roomStatusForDates(input: RoomDayInput, dates: string[]): RoomDay[] {
  const reservations = [...input.reservations].sort(
    (a, b) =>
      Number(b.status === 'CONFIRMED') - Number(a.status === 'CONFIRMED') ||
      a.checkIn.localeCompare(b.checkIn) ||
      a.id.localeCompare(b.id),
  );
  return dates.map((date): RoomDay => {
    const reservation = reservations.find((r) => r.checkIn <= date && date < r.checkOut);
    if (reservation) return { date, status: RoomDateStatus.BOOKED, reservation };
    if (!input.isActive) return { date, status: RoomDateStatus.BLOCKED, blockedReason: RoomBlockedReason.ROOM_DEACTIVATED };
    if (inRange(input.blockedRanges, date)) return { date, status: RoomDateStatus.BLOCKED, blockedReason: RoomBlockedReason.BLOCKED_RANGE };
    if (!inRange(input.availability, date)) return { date, status: RoomDateStatus.BLOCKED, blockedReason: RoomBlockedReason.NOT_OFFERED };
    return { date, status: RoomDateStatus.AVAILABLE };
  });
}
