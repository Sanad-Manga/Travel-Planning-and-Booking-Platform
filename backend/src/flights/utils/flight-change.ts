import { FlightBookingSegment } from '../schemas/flight-booking.schema';
import { bookingTotalCents, PassengerCountsInput } from './booking-price';

/**
 * FLT-27: what the replacement flight would cost with the booking's existing passengers and the
 * baggage fees already stored on the segment. The equal-fare route only accepts this total when it
 * equals the booking's current total, so baggage is never silently dropped or repriced.
 */
export function replacementTotalCents(
  segment: Pick<FlightBookingSegment, 'baggageFeeCents'>,
  farePerPassengerCents: number,
  passengerCounts: PassengerCountsInput,
): number {
  return bookingTotalCents(
    farePerPassengerCents,
    passengerCounts,
    segment.baggageFeeCents,
  );
}

/** Positive means the replacement costs more, zero means the fare is unchanged. */
export function fareDifferenceCents(
  currentTotalCents: number,
  replacementTotalCents: number,
): number {
  return replacementTotalCents - currentTotalCents;
}
