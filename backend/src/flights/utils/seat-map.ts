/**
 * FLT-28: the seat map of a cabin is derived from its `totalSeats` (no extra schema for the moderator to fill in).
 * Seats are numbered in rows of six: 1A..1F, 2A..2F, ... and the last row is partly filled when totalSeats is
 * not a multiple of six. A label is only unique within one cabin of one flight.
 */
export const SEATS_PER_ROW = 6;
export const SEAT_LETTERS = 'ABCDEF';

const SEAT_LABEL = /^([1-9]\d{0,3})([A-F])$/;

/** The label of the n-th seat (0-based) of a cabin. */
export function seatLabel(index: number): string {
  return `${Math.floor(index / SEATS_PER_ROW) + 1}${SEAT_LETTERS[index % SEATS_PER_ROW]}`;
}

/** Every seat label of a cabin with `totalSeats` seats. */
export function seatLabels(totalSeats: number): string[] {
  return Array.from({ length: totalSeats }, (_, index) => seatLabel(index));
}

/** Normalises user input ("12a " -> "12A"); returns null when it is not a seat label at all. */
export function normalizeSeat(input: string): string | null {
  const value = input.trim().toUpperCase();
  return SEAT_LABEL.test(value) ? value : null;
}

/** True when `seat` (already normalised) is a real seat of a cabin with `totalSeats` seats. */
export function seatExists(seat: string, totalSeats: number): boolean {
  const match = SEAT_LABEL.exec(seat);
  if (!match) return false;
  const index =
    (Number(match[1]) - 1) * SEATS_PER_ROW + SEAT_LETTERS.indexOf(match[2]);
  return index < totalSeats;
}
