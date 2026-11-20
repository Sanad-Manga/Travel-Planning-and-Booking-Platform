/** Seat counters every cabin carries (FLT-04). */
export interface SeatCounts {
  totalSeats: number;
  bookedSeats: number;
  heldSeats: number;
}

/** Available seats = total - booked - held (FLT-11). The single definition of the formula. */
export function availableSeats(cabin: SeatCounts): number {
  return cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats;
}

/** The same formula as a Mongo expression, evaluated by the database. */
export const AVAILABLE_SEATS_EXPR = {
  $subtract: ['$totalSeats', { $add: ['$bookedSeats', '$heldSeats'] }],
};

/**
 * Filter fragment: cabins with at least `seats` available.
 * Search spreads it into `find`; the FLT-22 hold spreads it into `findOneAndUpdate`
 * so "check and reserve" is one atomic operation (docs/contracts.md section 8).
 */
export function hasAtLeastSeats(seats: number) {
  return { $expr: { $gte: [AVAILABLE_SEATS_EXPR, seats] } };
}