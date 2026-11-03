import { Injectable } from '@nestjs/common';
import { BookingType } from '../common';

/**
 * Minutes a booking's hold is protected while its payment is PROCESSING, before the pause
 * is force-ended (lead's new rule for SCRUM-33). The real PaymentActivity (PAY-01) uses this;
 * the stub below does not need it, since nothing is ever PROCESSING without Stripe wired up.
 */
export const PAYMENT_PAUSE_MAX_MINUTES = 5;

export type PrepareExpiryResult = 'SKIP' | 'PAID' | 'EXPIRE';

/**
 * Decides what should happen to a PENDING_PAYMENT booking whose hold has run out, given
 * whatever payment attempt (if any) is in flight for it. Owned by Payments; PAY-01 (Stripe
 * PaymentIntents) provides the real implementation. Per the lead's rule:
 *  - SKIP: a payment is PROCESSING and within PAYMENT_PAUSE_MAX_MINUTES of entering that
 *    state. The hold is paused — leave the booking alone.
 *  - PAID: the pause ended because Stripe says the PaymentIntent succeeded (whether that was
 *    learned before the cap, or discovered when cancelling it after the cap). Confirm the
 *    booking instead of expiring it.
 *  - EXPIRE: nothing is in flight, or a payment reached FAILED/CANCELLED, or the cap was
 *    reached without success (cancel the PaymentIntent first, then report EXPIRE).
 *
 * BookingLifecycle calls this before ever expiring a hold — from both the sweep and the
 * lazy `expireIfDue` check — and never expires or confirms a booking on its own judgment.
 */
export interface PaymentActivity {
  prepareExpiry(
    type: BookingType,
    bookingId: string,
    now: Date,
  ): Promise<PrepareExpiryResult>;
}

/** DI token for PaymentActivity (an interface has no runtime value to inject by). */
export const PAYMENT_ACTIVITY = Symbol('PAYMENT_ACTIVITY');

/**
 * Stub until PAY-01 exists. There is no Stripe integration yet, so nothing is ever PROCESSING
 * from this service's point of view — always safe to expire. PaymentsModule provides this for
 * PAYMENT_ACTIVITY today; swap it for the real implementation when PAY-01 lands.
 */
@Injectable()
export class StubPaymentActivity implements PaymentActivity {
  async prepareExpiry(): Promise<PrepareExpiryResult> {
    return 'EXPIRE';
  }
}
