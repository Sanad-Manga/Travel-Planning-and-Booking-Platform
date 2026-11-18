import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

export interface CreatedIntent {
  id: string;
  clientSecret: string;
  status: string;
}

export interface RetrievedIntent {
  status: string;
}

export interface CreatedRefund {
  id: string;
  status: string;
}

/**
 * The one outbound call to Stripe. Owned by Payments (PAY-01). Never caches, never decides what
 * a status means — that's PaymentsService/StripePaymentActivity's job; this only talks to Stripe
 * and throws on failure (bad signature, network error, missing config).
 */
export interface StripeGateway {
  createPaymentIntent(
    amountCents: number,
    currency: string,
    metadata: Record<string, string>,
  ): Promise<CreatedIntent>;
  cancelPaymentIntent(id: string): Promise<void>;
  retrievePaymentIntent(id: string): Promise<RetrievedIntent>;
  /** Verifies the signature against the exact raw bytes and returns the parsed event, or throws. */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event;
  /**
   * PAY-03: refunds part of a succeeded PaymentIntent. `reason` is free text, stored in metadata
   * rather than Stripe's own `reason` enum (`duplicate`/`fraudulent`/`requested_by_customer`),
   * which cannot represent "cancelled per tier 2" or "airline cancelled the flight" without risking
   * a validation error on anything that doesn't fit it. `idempotencyKey` (deterministic per payment,
   * e.g. `refund-<paymentIntentId>`) makes two concurrent/retried calls for the same payment return
   * the SAME Stripe refund instead of creating two real ones — the DB-side unique index alone only
   * stops a second local row, not a second real charge-reversal at Stripe.
   */
  createRefund(paymentIntentId: string, amountCents: number, reason?: string, idempotencyKey?: string): Promise<CreatedRefund>;
}

/** DI token for StripeGateway (an interface has no runtime value to inject by). */
export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

/**
 * Real implementation, using the official `stripe` SDK (already a dependency, unused until now).
 * Reads `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` from `process.env` directly — like
 * `fx/exchange-rate-provider.ts` — rather than injecting `ConfigService`, and only at the moment
 * a call is actually made, never in the constructor: several e2e specs build `AppModule` (which
 * always includes PaymentsModule) without ever setting real Stripe keys, and must keep working
 * as long as they never hit a payment endpoint. Constructing `Stripe` eagerly here would throw
 * at module-bootstrap time for all of them.
 */
@Injectable()
export class StripePaymentGateway implements StripeGateway {
  private client?: Stripe;

  private getClient(): Stripe {
    if (!this.client) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
      this.client = new Stripe(key);
    }
    return this.client;
  }

  async createPaymentIntent(
    amountCents: number,
    currency: string,
    metadata: Record<string, string>,
  ): Promise<CreatedIntent> {
    const intent = await this.getClient().paymentIntents.create({
      amount: amountCents,
      currency: currency.toLowerCase(),
      metadata,
      automatic_payment_methods: { enabled: true },
    });
    return {
      id: intent.id,
      clientSecret: intent.client_secret as string,
      status: intent.status,
    };
  }

  async cancelPaymentIntent(id: string): Promise<void> {
    await this.getClient().paymentIntents.cancel(id);
  }

  async retrievePaymentIntent(id: string): Promise<RetrievedIntent> {
    const intent = await this.getClient().paymentIntents.retrieve(id);
    return { status: intent.status };
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    return this.getClient().webhooks.constructEvent(rawBody, signature, secret);
  }

  async createRefund(paymentIntentId: string, amountCents: number, reason?: string, idempotencyKey?: string): Promise<CreatedRefund> {
    const refund = await this.getClient().refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountCents,
        ...(reason ? { metadata: { reason } } : {}),
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    return { id: refund.id, status: refund.status ?? 'pending' };
  }
}
