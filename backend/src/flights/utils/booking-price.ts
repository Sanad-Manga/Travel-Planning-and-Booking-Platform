import { INFANT_FARE_PERCENT } from '../../common';

export interface PassengerCountsInput {
  adults: number;
  children: number;
  infants: number;
}

/** Seats needed: adults and children. Infants take no seat (FLT-22). */
export function seatsNeeded(counts: PassengerCountsInput): number {
  return counts.adults + counts.children;
}

/** An infant pays INFANT_FARE_PERCENT of the cabin fare, rounded to the nearest cent. */
export function infantFareCents(farePerPassengerCents: number): number {
  return Math.round((farePerPassengerCents * INFANT_FARE_PERCENT) / 100);
}

/** Total to pay in integer cents (never floats). FLT-19 adds the baggage fee on top of this. */
export function bookingTotalCents(
  farePerPassengerCents: number,
  counts: PassengerCountsInput,
): number {
  return (
    seatsNeeded(counts) * farePerPassengerCents +
    counts.infants * infantFareCents(farePerPassengerCents)
  );
}
