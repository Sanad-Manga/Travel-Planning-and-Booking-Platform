import {
  ConflictException,
  Inject,
  Injectable,
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
  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly registry: BookingProviderRegistry,
    private readonly policyAcceptance: PolicyAcceptanceService,
    private readonly lifecycle: BookingLifecycle,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  async create(user: AuthenticatedUser, dto: CreatePaymentDto): Promise<PaymentResponseDto> {
    const { bookingType, bookingId } = dto;
    await this.assertNoPaymentInFlight(bookingType, bookingId);

    const payable = await this.getPayableOrThrow(bookingType, bookingId, user.userId);
    this.assertPayable(payable);
    await this.policyAcceptance.assertAccepted(bookingType, bookingId);

    const intent = await this.stripe.createPaymentIntent(payable.amountCents, payable.currency, {
      bookingType,
      bookingId,
      userId: user.userId,
    });

    const created = await this.payments.create({
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

    const intent = await this.stripe.createPaymentIntent(payable.amountCents, payable.currency, {
      bookingType: previous.bookingType,
      bookingId: previous.bookingId.toString(),
      userId: user.userId,
    });

    const created = await this.payments.create({
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
      case 'payment_intent.succeeded':
        await this.onSucceeded(event.data.object as Stripe.PaymentIntent);
        return;
      case 'payment_intent.payment_failed':
        await this.onTerminal(event.data.object as Stripe.PaymentIntent, PaymentStatus.FAILED);
        return;
      case 'payment_intent.canceled':
        await this.onTerminal(event.data.object as Stripe.PaymentIntent, PaymentStatus.CANCELLED);
        return;
      default:
        return; // unhandled event types are acknowledged, not errors (Stripe's own guidance)
    }
  }

  private async onSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.payments.findOne({ stripePaymentIntentId: intent.id }).exec();
    if (!payment) return; // an intent we don't recognize — nothing to do
    if (payment.status === PaymentStatus.SUCCEEDED) return; // idempotent: already handled

    payment.status = PaymentStatus.SUCCEEDED;
    await payment.save();

    try {
      await this.lifecycle.confirmPaid(payment.bookingType, payment.bookingId.toString(), payment.stripePaymentIntentId);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        // The booking is no longer PENDING_PAYMENT (e.g. it already expired while this payment
        // was in flight). docs/contracts.md section 8: Payments must refund automatically here
        // and never revive the booking — that's PAY-03's job (not built yet). Recorded as a known
        // gap, not silently dropped: the Payment row stays SUCCEEDED so the mismatch is visible.
        // TODO(PAY-03): issue a refund for `payment.stripePaymentIntentId` and notify the user.
        return;
      }
      throw error;
    }
  }

  private async onTerminal(intent: Stripe.PaymentIntent, status: PaymentStatus.FAILED | PaymentStatus.CANCELLED): Promise<void> {
    await this.payments
      .updateOne({ stripePaymentIntentId: intent.id, status: { $ne: PaymentStatus.SUCCEEDED } }, { $set: { status } })
      .exec();
  }

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
