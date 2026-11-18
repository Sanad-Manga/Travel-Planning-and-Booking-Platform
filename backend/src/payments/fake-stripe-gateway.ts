import Stripe from 'stripe';
import { CreatedIntent, CreatedRefund, RetrievedIntent, StripeGateway } from './stripe-gateway';

interface FakeIntent {
  status: string;
  amountCents: number;
  currency: string;
}

interface FakeRefund {
  status: string;
  amountCents: number;
  paymentIntentId: string;
}

/** In-memory stand-in for StripeGateway, in the style of FakeBookingProvider/FakeExchangeRateProvider. */
export class FakeStripeGateway implements StripeGateway {
  readonly intents = new Map<string, FakeIntent>();
  readonly refunds = new Map<string, FakeRefund>();
  private nextId = 1;
  private nextRefundId = 1;
  /** Overrides the status the next `createRefund` call returns; default is 'succeeded'. */
  private nextRefundStatus: string | null = null;
  /** Queued event for the next `constructWebhookEvent` call; null = verify fails (bad signature). */
  private nextEvent: Stripe.Event | 'INVALID_SIGNATURE' | null = null;

  async createPaymentIntent(amountCents: number, currency: string): Promise<CreatedIntent> {
    const id = `pi_fake_${this.nextId++}`;
    this.intents.set(id, { status: 'requires_payment_method', amountCents, currency });
    return { id, clientSecret: `${id}_secret`, status: 'requires_payment_method' };
  }

  async cancelPaymentIntent(id: string): Promise<void> {
    const intent = this.intents.get(id);
    if (!intent) return;
    // Real Stripe refuses to cancel a PaymentIntent that already succeeded — mirror that so
    // callers' try/catch-then-retrieve pattern can be tested the same way as against the real API.
    if (intent.status === 'succeeded') throw new Error('cannot cancel a succeeded PaymentIntent');
    intent.status = 'canceled';
  }

  async retrievePaymentIntent(id: string): Promise<RetrievedIntent> {
    return { status: this.intents.get(id)?.status ?? 'canceled' };
  }

  /** Test helper: move a fake PaymentIntent to any Stripe status without a real API call. */
  setStatus(id: string, status: string): void {
    const intent = this.intents.get(id);
    if (intent) intent.status = status;
  }

  async createRefund(paymentIntentId: string, amountCents: number): Promise<CreatedRefund> {
    const id = `re_fake_${this.nextRefundId++}`;
    const status = this.nextRefundStatus ?? 'succeeded';
    this.nextRefundStatus = null;
    this.refunds.set(id, { status, amountCents, paymentIntentId });
    return { id, status };
  }

  /** Test helper: makes the NEXT `createRefund` call return this status instead of 'succeeded'. */
  queueNextRefundStatus(status: string): void {
    this.nextRefundStatus = status;
  }

  /** Test helper: move a fake Refund to any Stripe status without a real API call. */
  setRefundStatus(id: string, status: string): void {
    const refund = this.refunds.get(id);
    if (refund) refund.status = status;
  }

  /** Test helper: what the next `constructWebhookEvent` call returns, or 'INVALID_SIGNATURE' to make it throw. */
  queueWebhookEvent(event: Stripe.Event | 'INVALID_SIGNATURE'): void {
    this.nextEvent = event;
  }

  constructWebhookEvent(): Stripe.Event {
    if (this.nextEvent === null || this.nextEvent === 'INVALID_SIGNATURE') {
      throw new Error('invalid signature');
    }
    const event = this.nextEvent;
    this.nextEvent = null;
    return event;
  }
}
