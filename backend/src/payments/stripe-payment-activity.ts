import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingType, PAYMENT_PAUSE_MAX_MINUTES, PaymentStatus } from '../common';
import { PaymentActivity, PrepareExpiryResult } from './payment-activity';
import { Payment } from './schemas/payment.schema';
import { STRIPE_GATEWAY, StripeGateway } from './stripe-gateway';

/**
 * PAY-01's real `PaymentActivity`: implements docs/contracts.md section 8's pause rule.
 * - No payment in flight for the booking -> EXPIRE (the normal hold clock applies).
 * - REQUIRES_PAYMENT in flight (created but never reached PROCESSING) -> never pauses the hold;
 *   cancel the PaymentIntent and EXPIRE, same as any other expiry.
 * - PROCESSING, still within PAYMENT_PAUSE_MAX_MINUTES of entering that state -> SKIP (the hold
 *   is paused; leave the booking alone).
 * - PROCESSING past the pause cap -> cancel the PaymentIntent first, then ask Stripe what it
 *   actually says: SUCCEEDED means confirm instead of expiring (a true race, not a guess), any
 *   other status means EXPIRE.
 * Replaces `StubPaymentActivity` as PAYMENT_ACTIVITY's binding in payments.module.ts.
 */
@Injectable()
export class StripePaymentActivity implements PaymentActivity {
  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  async prepareExpiry(type: BookingType, bookingId: string, now: Date): Promise<PrepareExpiryResult> {
    const inFlight = await this.payments
      .findOne({
        bookingType: type,
        bookingId: new Types.ObjectId(bookingId),
        status: { $in: [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.PROCESSING] },
      })
      .sort({ createdAt: -1 })
      .exec();

    if (!inFlight) return 'EXPIRE';

    if (inFlight.status === PaymentStatus.PROCESSING) {
      const inFlightDoc = inFlight as unknown as { updatedAt: Date };
      const pauseDeadline = new Date(inFlightDoc.updatedAt.getTime() + PAYMENT_PAUSE_MAX_MINUTES * 60_000);
      if (now < pauseDeadline) return 'SKIP';
    }

    // Either never paused (REQUIRES_PAYMENT) or past the pause cap (PROCESSING): cancel first,
    // then check what Stripe actually says before deciding EXPIRE vs PAID.
    try {
      await this.stripe.cancelPaymentIntent(inFlight.stripePaymentIntentId);
    } catch {
      // Stripe refuses to cancel an already-succeeded/already-canceled intent — fine, the
      // retrieve below reports the true status either way.
    }
    let latest;
    try {
      latest = await this.stripe.retrievePaymentIntent(inFlight.stripePaymentIntentId);
    } catch {
      // Stripe is unreachable or erroring (network issue, outage) — leave the booking exactly as
      // it is and let the next sweep/lazy check try again, rather than crashing the caller (a 500
      // on a booking read, per the real repro that surfaced this) or guessing at PAID vs EXPIRE
      // when the one source of truth for that decision couldn't actually be reached.
      return 'SKIP';
    }
    if (latest.status === 'succeeded') {
      inFlight.status = PaymentStatus.SUCCEEDED;
      await inFlight.save();
      return { outcome: 'PAID', paymentRef: inFlight.stripePaymentIntentId };
    }
    inFlight.status = PaymentStatus.CANCELLED;
    await inFlight.save();
    return 'EXPIRE';
  }
}
