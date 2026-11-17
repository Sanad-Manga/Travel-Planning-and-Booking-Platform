import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingType, PaymentStatus } from '../../common';

/**
 * PAY-01: one attempt to pay a booking via a Stripe PaymentIntent. "Store only the Stripe
 * payment ID, amount, currency and status" (the ticket's own words) — bookingType/bookingId/
 * userId exist only so Payments can look up and own-scope attempts, not as "Stripe data".
 * A booking may have several Payment rows over time (one per retry); only one may be
 * REQUIRES_PAYMENT/PROCESSING for a given booking at once (enforced in PaymentsService, not
 * here, since a FAILED/CANCELLED row must be allowed to coexist with a later successful one).
 */
@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** The Stripe PaymentIntent id (pi_...) — the only Stripe identifier ever stored. */
  @Prop({ type: String, required: true, unique: true })
  stripePaymentIntentId: string;

  @Prop({ type: Number, required: true, min: 1 })
  amountCents: number;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatus),
    required: true,
    default: PaymentStatus.REQUIRES_PAYMENT,
  })
  status: PaymentStatus;
}

export type PaymentDocument = HydratedDocument<Payment>;

/** As returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type PaymentLean = Payment & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const PaymentSchema = SchemaFactory.createForClass(Payment);

/** "Is a payment in flight for this booking" — the lookup PaymentActivity.prepareExpiry makes. */
PaymentSchema.index({ bookingType: 1, bookingId: 1, status: 1, createdAt: -1 });
