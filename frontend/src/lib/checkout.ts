import { ApiError } from './api';
import type { BookingType } from '@/api/usePollBooking';

/** Where the traveller lands after paying: the booking status pages (SCRUM-166 flights, SCRUM-173 hotels). */
export function bookingStatusPath(type: BookingType, bookingId: string): string {
  return `/bookings/${type === 'flight' ? 'flights' : 'hotels'}/${encodeURIComponent(bookingId)}`;
}

/** The backend wants the upper-case booking type in paths and bodies. */
export const apiBookingType = (type: BookingType): 'FLIGHT' | 'HOTEL' => (type === 'flight' ? 'FLIGHT' : 'HOTEL');

/** A Stripe publishable key starts with `pk_`. A secret key (`sk_`) must never reach the browser, so it is refused here. */
export function usablePublishableKey(value: string | undefined): string | null {
  const key = (value ?? '').trim();
  return key.startsWith('pk_') ? key : null;
}

export interface StripeFailure {
  type?: string;
  code?: string;
  message?: string;
}

/**
 * Words for a failed card payment. Stripe's own message is safe to show for a card problem ("Your card was declined.");
 * anything else (network, setup) gets a general sentence so no internal detail reaches the screen.
 */
export function describeCardFailure(failure: StripeFailure): { message: string; hint: string } {
  if (failure.type === 'card_error' && failure.message) {
    return { message: failure.message, hint: 'Check the card details or use another card, then try again.' };
  }
  if (failure.type === 'validation_error' && failure.message) {
    return { message: failure.message, hint: 'Correct the card details and try again.' };
  }
  return { message: 'The payment could not be completed.', hint: 'Try again in a moment. If you are not sure whether it went through, check your booking status first.' };
}

type Call = <T>(path: string, options?: { method?: 'GET' | 'POST'; body?: unknown }) => Promise<T>;

export interface PaymentRecord {
  id: string;
  status: 'REQUIRES_PAYMENT' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  clientSecret?: string;
}

export type RetryResult = { kind: 'new-payment'; payment: PaymentRecord } | { kind: 'already-paid' };

/** The previous attempt is not yet marked failed (the Stripe webhook is a little late) after waiting this long. */
export class PaymentStillSettlingError extends Error {
  constructor() {
    super('The previous payment attempt is still being settled.');
    this.name = 'PaymentStillSettlingError';
  }
}

/**
 * Start a new attempt after a failed card payment. The backend only allows `POST /payments/:id/retry` once the failed
 * attempt is recorded as FAILED or CANCELLED, which happens when Stripe's webhook arrives a moment after the browser
 * saw the decline. So ask for the payment until it is terminal (up to `tries` seconds), then retry. If the earlier attempt
 * turns out to have gone through, report that instead of charging twice.
 */
export async function retryFailedPayment(
  paymentId: string,
  call: Call,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  tries = 8,
): Promise<RetryResult> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const current = await call<PaymentRecord>(`/api/payments/${encodeURIComponent(paymentId)}`);
    if (current.status === 'SUCCEEDED' || current.status === 'PROCESSING') return { kind: 'already-paid' };
    if (current.status === 'FAILED' || current.status === 'CANCELLED') {
      const payment = await call<PaymentRecord>(`/api/payments/${encodeURIComponent(paymentId)}/retry`, { method: 'POST' });
      return { kind: 'new-payment', payment };
    }
    await sleep(1000);
  }
  throw new PaymentStillSettlingError();
}

export type CheckoutProblem = 'hold-expired' | 'payment-in-progress' | 'other';

/** Sort a backend refusal into what the page should say. The backend answers 409 for both cases, so read the message. */
export function classifyPaymentRefusal(error: unknown): CheckoutProblem {
  if (!(error instanceof ApiError) || error.statusCode !== 409) return 'other';
  const text = error.message.toLowerCase();
  if (text.includes('expired') || text.includes('not awaiting payment')) return 'hold-expired';
  if (text.includes('already in progress')) return 'payment-in-progress';
  return 'other';
}
