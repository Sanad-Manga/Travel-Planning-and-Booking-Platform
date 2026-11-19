import { BookingType, RefundStatus } from '../common';

/**
 * PAY-03's published cross-module return shape — what `issue` and `getLatestForBooking` give
 * callers (Flights/Hotels cancel flows) to show on their own booking-details responses.
 */
export interface RefundSummary {
  id: string;
  bookingType: BookingType;
  bookingId: string;
  status: RefundStatus;
  amountCents: number;
  currency: string;
  reason?: string;
  createdAt: Date;
}
