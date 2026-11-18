import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { AuthenticatedUser, BookingType, NotificationType, PaymentStatus, RefundStatus } from '../common';
import { assertOwner } from '../common/ownership';
import { NotificationsService } from '../notifications';
import { formatMoney } from '../payments/money';
import { Payment } from '../payments/schemas/payment.schema';
import { STRIPE_GATEWAY, StripeGateway } from '../payments/stripe-gateway';
import { RefundSummary } from './refund-summary';
import { Refund, RefundLean } from './schemas/refund.schema';

export interface IssueRefundInput {
  bookingType: BookingType;
  bookingId: string;
  amountCents: number;
  reason?: string;
}

/** Maps a Stripe Refund's own status onto our domain enum; anything non-terminal stays PENDING. */
function toRefundStatus(stripeStatus: string): RefundStatus {
  if (stripeStatus === 'succeeded') return RefundStatus.REFUNDED;
  if (stripeStatus === 'failed' || stripeStatus === 'canceled') return RefundStatus.FAILED;
  return RefundStatus.PENDING;
}

/**
 * PAY-03: issues a Stripe refund for a booking's SUCCEEDED payment, records its status, and
 * notifies the user. Published contract (docs/contracts.md section 7) for Flights/Hotels'
 * cancellation flows (FLT-26, HTL-21, FLT-06), which are not this module's to build — they call
 * `issue` right after their own `BookingLifecycle.transition(..., CANCELLED)`, and read
 * `getLatestForBooking` to show refund status on their own booking-details responses.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Called on every cancellation with a positive refund amount. `amountCents` is whatever the
   * caller already computed (RefundCalculator tiers, or 100% for a provider-initiated
   * cancellation) — this method never recomputes it, only validates it against what was paid.
   */
  async issue(input: IssueRefundInput): Promise<RefundSummary> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BadRequestException('Refund amount must be a positive integer number of cents');
    }

    const payment = await this.payments
      .findOne({ bookingType: input.bookingType, bookingId: new Types.ObjectId(input.bookingId), status: PaymentStatus.SUCCEEDED })
      .sort({ createdAt: -1 })
      .exec();
    if (!payment) {
      throw new ConflictException(`No successful payment found for this ${input.bookingType} booking`);
    }
    if (input.amountCents > payment.amountCents) {
      throw new ConflictException('Refund amount exceeds the amount paid');
    }

    // Pre-check for the common case; the schema's unique index on stripePaymentIntentId is the
    // real atomic guarantee against two concurrent `issue` calls for the same payment (mirrors
    // PaymentsService.savePayment's 11000-to-409 pattern).
    const already = await this.refunds.exists({ stripePaymentIntentId: payment.stripePaymentIntentId }).exec();
    if (already) {
      throw new ConflictException('A refund has already been issued for this booking');
    }

    // Deterministic per payment, not per call: two concurrent or retried `issue` calls for the
    // same payment reach Stripe with the SAME key, so Stripe itself returns the one real refund
    // instead of creating a second one — the DB's unique index below only stops a second local
    // row, not a second real charge-reversal if the check-then-call-then-save sequence races.
    const idempotencyKey = `refund-${payment.stripePaymentIntentId}`;
    const stripeRefund = await this.stripe.createRefund(payment.stripePaymentIntentId, input.amountCents, input.reason, idempotencyKey);
    const status = toRefundStatus(stripeRefund.status);

    let created: RefundLean;
    try {
      created = (await this.refunds.create({
        bookingType: input.bookingType,
        bookingId: payment.bookingId,
        userId: payment.userId,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        stripeRefundId: stripeRefund.id,
        amountCents: input.amountCents,
        currency: payment.currency,
        status,
        reason: input.reason,
      })) as unknown as RefundLean;
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException('A refund has already been issued for this booking');
      }
      throw err;
    }

    await this.notify(created, status);
    return this.toSummary(created);
  }

  /** The most recent refund for a booking, or null if none was ever issued. */
  async getLatestForBooking(bookingType: BookingType, bookingId: string): Promise<RefundSummary | null> {
    const refund = await this.refunds
      .findOne({ bookingType, bookingId: new Types.ObjectId(bookingId) })
      .sort({ createdAt: -1 })
      .lean<RefundLean>()
      .exec();
    return refund ? this.toSummary(refund) : null;
  }

  async getById(user: AuthenticatedUser, id: string): Promise<RefundSummary> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Refund not found');
    const refund = await this.refunds.findById(id).lean<RefundLean>().exec();
    if (!refund) throw new NotFoundException('Refund not found');
    assertOwner(user, { ownerId: refund.userId }, 'Refund not found');
    return this.toSummary(refund);
  }

  /**
   * A refund left PENDING at creation (Stripe hasn't settled it yet) reaches a terminal state
   * later via a `refund.updated` event — delegated here from PaymentsService.handleWebhookEvent.
   * Idempotent: a refund that is already terminal, or an event for a refund we don't recognize,
   * is a safe no-op, and the user is only notified when the status actually changes.
   */
  async applyStripeRefundEvent(event: Stripe.Event): Promise<void> {
    const stripeRefund = event.data.object as Stripe.Refund;
    const refund = await this.refunds.findOne({ stripeRefundId: stripeRefund.id, status: RefundStatus.PENDING }).exec();
    if (!refund) return;

    const status = toRefundStatus(stripeRefund.status ?? 'pending');
    if (status === RefundStatus.PENDING) return;

    refund.status = status;
    await refund.save();
    await this.notify(refund, status);
  }

  /**
   * The refund itself (Stripe call + DB row) is already committed by the time this runs — a
   * notification failure must never surface as if the refund had failed, so this is caught and
   * logged rather than propagated. (`NotificationsService.notify` is documented to never throw on
   * its own, but this doesn't lean on that promise for something this consequential to get wrong.)
   */
  private async notify(refund: { userId: Types.ObjectId; amountCents: number; currency: string }, status: RefundStatus): Promise<void> {
    const amount = formatMoney(refund.amountCents, refund.currency);
    try {
      await this.notifications.notify({
        userId: refund.userId.toString(),
        type: NotificationType.REFUND_UPDATE,
        title: status === RefundStatus.REFUNDED ? 'Refund completed' : status === RefundStatus.FAILED ? 'Refund failed' : 'Refund issued',
        message:
          status === RefundStatus.REFUNDED
            ? `Your refund of ${amount} has been completed.`
            : status === RefundStatus.FAILED
              ? `Your refund of ${amount} could not be completed. Please contact support.`
              : `Your refund of ${amount} is being processed.`,
      });
    } catch (error) {
      this.logger.error(`Failed to notify user ${refund.userId.toString()} of a ${status} refund`, error instanceof Error ? error.stack : String(error));
    }
  }

  private toSummary(refund: {
    _id: Types.ObjectId;
    bookingType: BookingType;
    bookingId: Types.ObjectId;
    status: RefundStatus;
    amountCents: number;
    currency: string;
    reason?: string;
    createdAt: Date;
  }): RefundSummary {
    return {
      id: refund._id.toString(),
      bookingType: refund.bookingType,
      bookingId: refund.bookingId.toString(),
      status: refund.status,
      amountCents: refund.amountCents,
      currency: refund.currency,
      reason: refund.reason,
      createdAt: refund.createdAt,
    };
  }
}
