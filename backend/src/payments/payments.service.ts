import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { AuthenticatedUser, BookingStatus, BookingType, PaymentStatus } from '../common';
import { assertOwner } from '../common/ownership';
import { BookingLifecycle } from './booking-lifecycle.service';
import { Payable } from './booking-provider.interface';
import { BookingProviderRegistry } from './booking-provider.registry';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import { Payment, PaymentLean } from './schemas/payment.schema';
import { STRIPE_GATEWAY, StripeGateway } from './stripe-gateway';

/**
 * PAY-01: create/retry a Stripe PaymentIntent for a PENDING_PAYMENT booking, read one back, and
 * turn a verified webhook event into a confirmed booking. Card data never reaches this service —
 * it only ever handles Stripe's own ids, amounts and statuses (docs/contracts.md "store only the
 * Stripe payment ID, amount, currency and status").
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly registry: BookingProviderRegistry,
    private readonly policyAcceptance: PolicyAcceptanceService,
    private readonly lifecycle: BookingLifecycle,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  async create(user: AuthenticatedUser, dto: CreatePaymentDto): Promise<PaymentResponseDto> {
    const { bookingType, bookingId } = dto;
    // Ownership first: a stranger probing someone else's bookingId must see 404, never a 409 that
    // confirms the booking exists and has a payment in flight.
    const payable = await this.getPayableOrThrow(bookingType, bookingId, user.userId);
    this.assertPayable(payable);
    await this.assertNoPaymentInFlight(bookingType, bookingId);
    await this.policyAcceptance.assertAccepted(bookingType, bookingId);

    const intent = await this.stripe.createPaymentIntent(payable.amountCents, payable.currency, {
      bookingType,
      bookingId,
      userId: user.userId,
    });

    const created = await this.savePayment(intent.id, {
      bookingType,
      bookingId: new Types.ObjectId(bookingId),
      userId: new Types.ObjectId(user.userId),
      stripePaymentIntentId: intent.id,
      amountCents: payable.amountCents,
      currency: payable.currency,
      status: PaymentStatus.REQUIRES_PAYMENT,
    });

    return this.toResponse(created, intent.clientSecret);
  }

  async retry(user: AuthenticatedUser, paymentId: string): Promise<PaymentResponseDto> {
    const previous = await this.findOwnedOrThrow(user, paymentId);
    if (previous.status !== PaymentStatus.FAILED && previous.status !== PaymentStatus.CANCELLED) {
      throw new ConflictException('This payment is not in a retryable state');
    }

    const payable = await this.getPayableOrThrow(previous.bookingType, previous.bookingId.toString(), user.userId);
    this.assertPayable(payable);

    // The previous intent may still be payable from the customer's side (e.g. a cached
    // clientSecret) even though we've marked it FAILED/CANCELLED locally — cancel it for real so
    // it can never be paid alongside the new one (double charge, with no refund until PAY-03).
    try {
      await this.stripe.cancelPaymentIntent(previous.stripePaymentIntentId);
    } catch {
      // Already terminal on Stripe's side — fine, that's the outcome we wanted anyway.
    }

    const intent = await this.stripe.createPaymentIntent(payable.amountCents, payable.currency, {
      bookingType: previous.bookingType,
      bookingId: previous.bookingId.toString(),
      userId: user.userId,
    });

    const created = await this.savePayment(intent.id, {
      bookingType: previous.bookingType,
      bookingId: previous.bookingId,
      userId: new Types.ObjectId(user.userId),
      stripePaymentIntentId: intent.id,
      amountCents: payable.amountCents,
      currency: payable.currency,
      status: PaymentStatus.REQUIRES_PAYMENT,
    });

    return this.toResponse(created, intent.clientSecret);
  }

  async getById(user: AuthenticatedUser, paymentId: string): Promise<PaymentResponseDto> {
    const payment = await this.findOwnedOrThrow(user, paymentId);
    return this.toResponse(payment);
  }

  /**
   * The ONLY path that confirms a paid booking (docs/contracts.md "Confirmation rule"). Never
   * trusts the client — only a signature-verified Stripe event reaches here (PaymentsController).
   * Idempotent: a repeated `payment_intent.succeeded` for the same intent is a safe no-op.
   */
  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.processing':
        await this.setNonSuccessStatus(event.data.object as Stripe.PaymentIntent, PaymentStatus.PROCESSING);
        return;
      case 'payment_intent.succeeded':
        await this.onSucceeded(event.data.object as Stripe.PaymentIntent);
        return;
      case 'payment_intent.payment_failed':
        await this.setNonSuccessStatus(event.data.object as Stripe.PaymentIntent, PaymentStatus.FAILED);
        return;
      case 'payment_intent.canceled':
        await this.setNonSuccessStatus(event.data.object as Stripe.PaymentIntent, PaymentStatus.CANCELLED);
        return;
      default:
        return; // unhandled event types are acknowledged, not errors (Stripe's own guidance)
    }
  }

  /**
   * Confirms the booking BEFORE marking the payment SUCCEEDED, not after. If `confirmPaid` throws
   * a transient error (e.g. a DB hiccup), this method also throws, the controller returns 500,
   * and Stripe retries the webhook — crucially, `payment.status` is still not SUCCEEDED at that
   * point, so the retry reaches `confirmPaid` again instead of short-circuiting on the idempotency
   * check below and leaving the booking stuck PENDING_PAYMENT while the customer was charged.
   */
  private async onSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.payments.findOne({ stripePaymentIntentId: intent.id }).exec();
    if (!payment) return; // an intent we don't recognize — nothing to do
    if (payment.status === PaymentStatus.SUCCEEDED) return; // idempotent: already fully handled

    if (intent.amount !== payment.amountCents || intent.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      // Stripe's own charged amount disagrees with what we recorded at creation — something is
      // wrong (integration bug, or the intent was tampered with outside our flow). The money was
      // genuinely collected, so it must stay visible for manual resolution/PAY-03, but the booking
      // must NOT be auto-confirmed for a mismatched amount.
      this.logger.error(
        `PaymentIntent ${intent.id} succeeded with amount ${intent.amount} ${intent.currency}, expected ${payment.amountCents} ${payment.currency} — booking NOT confirmed, needs manual review`,
      );
      payment.status = PaymentStatus.SUCCEEDED;
      await payment.save();
      return;
    }

    try {
      await this.lifecycle.confirmPaid(payment.bookingType, payment.bookingId.toString(), payment.stripePaymentIntentId);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        // The booking is no longer PENDING_PAYMENT (e.g. it already expired while this payment
        // was in flight). docs/contracts.md section 8: Payments must refund automatically here
        // and never revive the booking — that's PAY-03's job (not built yet). Recorded as a known
        // gap, not silently dropped: the payment is still marked SUCCEEDED below so the mismatch
        // stays visible for a manual/PAY-03 refund, rather than retried forever.
        // TODO(PAY-03): issue a refund for `payment.stripePaymentIntentId` and notify the user.
        payment.status = PaymentStatus.SUCCEEDED;
        await payment.save();
        return;
      }
      throw error; // transient failure: stays non-SUCCEEDED so Stripe's retry tries confirmPaid again
    }

    payment.status = PaymentStatus.SUCCEEDED;
    await payment.save();
  }

  private async setNonSuccessStatus(
    intent: Stripe.PaymentIntent,
    status: PaymentStatus.PROCESSING | PaymentStatus.FAILED | PaymentStatus.CANCELLED,
  ): Promise<void> {
    // PROCESSING only ever moves a payment forward from REQUIRES_PAYMENT. Without this restriction,
    // a `payment_intent.processing` event arriving out of order after a `payment_failed`/`canceled`
    // event had already landed would flip an already-terminal payment back to PROCESSING.
    const allowedFrom =
      status === PaymentStatus.PROCESSING
        ? [PaymentStatus.REQUIRES_PAYMENT]
        : [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.PROCESSING];
    await this.payments.updateOne({ stripePaymentIntentId: intent.id, status: { $in: allowedFrom } }, { $set: { status } }).exec();
  }

  /** Cheap fast-fail for the common case; NOT the real guarantee (see savePayment). */
  private async assertNoPaymentInFlight(bookingType: BookingType, bookingId: string): Promise<void> {
    const inFlight = await this.payments
      .exists({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        status: { $in: [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.PROCESSING] },
      })
      .exec();
    if (inFlight) throw new ConflictException('A payment is already in progress for this booking');
  }

  /**
   * The actual atomic "only one in flight per booking" guarantee: `payment.schema.ts`'s unique
   * partial index rejects a second concurrent insert with Mongo error 11000, which becomes a 409
   * here. `assertNoPaymentInFlight` above is only a friendlier fast path for the common case —
   * two requests racing past it and both reaching this insert is exactly what the index prevents.
   * The losing request has already created a REAL Stripe PaymentIntent before reaching here (the
   * intent has to exist to even attempt this insert) — on a loss, cancel it so it isn't left
   * dangling in Stripe forever, untracked by any Payment row.
   */
  private async savePayment(
    stripePaymentIntentId: string,
    doc: {
      bookingType: BookingType;
      bookingId: Types.ObjectId;
      userId: Types.ObjectId;
      stripePaymentIntentId: string;
      amountCents: number;
      currency: string;
      status: PaymentStatus;
    },
  ): Promise<PaymentLean> {
    try {
      return (await this.payments.create(doc)) as unknown as PaymentLean;
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        try {
          await this.stripe.cancelPaymentIntent(stripePaymentIntentId);
        } catch (cancelErr) {
          this.logger.error(`Failed to cancel orphaned PaymentIntent ${stripePaymentIntentId} after a lost race`, cancelErr as Error);
        }
        throw new ConflictException('A payment is already in progress for this booking');
      }
      throw err;
    }
  }

  private async getPayableOrThrow(bookingType: BookingType, bookingId: string, userId: string): Promise<Payable> {
    const provider = this.registry.tryGet(bookingType);
    if (!provider || !provider.getPayable) {
      throw new ConflictException(`Payments for ${bookingType} bookings are not available yet`);
    }
    const payable = await provider.getPayable(bookingId, userId);
    if (!payable) throw new NotFoundException(`${bookingType} booking not found`);
    return payable;
  }

  private assertPayable(payable: Payable): void {
    if (payable.status !== BookingStatus.PENDING_PAYMENT || !payable.holdExpiresAt || payable.holdExpiresAt <= new Date()) {
      throw new ConflictException('This booking is not awaiting payment, or its hold has expired');
    }
  }

  private async findOwnedOrThrow(user: AuthenticatedUser, paymentId: string): Promise<PaymentLean> {
    if (!Types.ObjectId.isValid(paymentId)) throw new NotFoundException('Payment not found');
    const payment = await this.payments.findById(paymentId).lean<PaymentLean>().exec();
    if (!payment) throw new NotFoundException('Payment not found');
    assertOwner(user, { ownerId: payment.userId }, 'Payment not found');
    return payment;
  }

  private toResponse(
    payment: { _id: Types.ObjectId; bookingType: BookingType; bookingId: Types.ObjectId; status: PaymentStatus; amountCents: number; currency: string },
    clientSecret?: string,
  ): PaymentResponseDto {
    return {
      id: payment._id.toString(),
      bookingType: payment.bookingType,
      bookingId: payment.bookingId.toString(),
      status: payment.status,
      amountCents: payment.amountCents,
      currency: payment.currency,
      ...(clientSecret ? { clientSecret } : {}),
    };
  }
}
