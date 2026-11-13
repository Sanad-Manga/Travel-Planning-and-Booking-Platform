/** Pure rules of the hotel search (HTL-11). No database: everything here is unit tested on its own. */

export interface DateRange {
  startDate: string;
  endDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const toUtcDay = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);

/** Number of nights of a stay [checkIn, checkOut): checkout day is not a night. Both are YYYY-MM-DD, checkOut > checkIn. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((toUtcDay(checkOut) - toUtcDay(checkIn)) / DAY_MS);
}

/** Today's date in UTC as YYYY-MM-DD (contracts section 3: dates are UTC). */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * True if every night checkIn ... checkOut-1 is bookable. Ranges are half-open [startDate, endDate), so a range
 * ending on a day and the next one starting on it are adjacent and together cover the nights between: the ranges
 * are walked in order and "merged" on the fly (HTL-04 allows adjacent ranges, a gap or an uncovered night fails).
 */
export function coversStay(ranges: DateRange[], checkIn: string, checkOut: string): boolean {
  let coveredUntil = checkIn; // every night before this day is already covered
  for (const range of [...ranges].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    if (range.startDate > coveredUntil) return false; // a gap: the night `coveredUntil` is not available
    if (range.endDate > coveredUntil) coveredUntil = range.endDate;
    if (coveredUntil >= checkOut) return true;
  }
  return coveredUntil >= checkOut;
}

export interface RoomChoice {
  maxOccupancy: number;
  pricePerNightCents: number;
}

/**
 * Feasibility check, NOT a booking: can exactly `rooms` of the given free rooms sleep `guests` people together, and
 * what is the cheapest such combination (sum of pricePerNightCents)? Small exact dynamic programme over
 * (rooms chosen, guests covered, capped at `guests`), so the answer is the true minimum and never says "no" when a
 * combination exists (e.g. one cheap big room plus one cheap small room). Returns null if no combination works.
 * Cost: O(freeRooms x rooms x guests); the DTO caps rooms and guests so this stays tiny.
 */
export function cheapestNightlyCombination(free: RoomChoice[], rooms: number, guests: number): number | null {
  if (free.length < rooms) return null;
  const INF = Number.POSITIVE_INFINITY;
  // best[k][c] = cheapest nightly price using k rooms that cover c guests (c capped at `guests`).
  const best: number[][] = Array.from({ length: rooms + 1 }, () => new Array<number>(guests + 1).fill(INF));
  best[0][0] = 0;
  for (const room of free) {
    for (let k = rooms - 1; k >= 0; k--) {
      for (let c = 0; c <= guests; c++) {
        if (best[k][c] === INF) continue;
        const covered = Math.min(guests, c + room.maxOccupancy);
        const cost = best[k][c] + room.pricePerNightCents;
        if (cost < best[k + 1][covered]) best[k + 1][covered] = cost;
      }
    }
  }
  return best[rooms][guests] === INF ? null : best[rooms][guests];
}
