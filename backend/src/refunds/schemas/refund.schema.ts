import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingType, RefundStatus } from '../../common';

/**
 * PAY-03: one refund issued for one SUCCEEDED Payment. `stripePaymentIntentId` is unique — a
 * booking's cancellation refund is issued exactly once; a second `RefundsService.issue` call for
 * the same payment is a 409, never a second row (docs/contracts.md "refund amount is never above
 * what was paid" combined with "one refund per cancellation" from the acceptance criteria).
 */
@Schema({ timestamps: true, collection: 'refunds' })
export class Refund {
  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** Which Payment this refunds — the Stripe PaymentIntent id (pi_...). */
  @Prop({ type: String, required: true, unique: true })
  stripePaymentIntentId: string;

  /** The Stripe Refund id (re_...). */
  @Prop({ type: String, required: true, unique: true })
  stripeRefundId: string;

  @Prop({ type: Number, required: true, min: 1 })
  amountCents: number;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({
    type: String,
    enum: Object.values(RefundStatus),
    required: true,
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;

  @Prop({ type: String })
  reason?: string;
}

export type RefundDocument = HydratedDocument<Refund>;

/** As returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type RefundLean = Refund & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const RefundSchema = SchemaFactory.createForClass(Refund);

/** "Is there already a refund for this booking" — the lookup `getLatestForBooking` makes. */
RefundSchema.index({ bookingType: 1, bookingId: 1, createdAt: -1 });
