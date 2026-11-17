import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingType, PaymentStatus } from '../../common';

/**
 * PAY-01: one attempt to pay a booking via a Stripe PaymentIntent. "Store only the Stripe
 * payment ID, amount, currency and status" (the ticket's own words) — bookingType/bookingId/
 * userId exist only so Payments can look up and own-scope attempts, not as "Stripe data".
 * A booking may have several Payment rows over time (one per retry); only one may be
 * REQUIRES_PAYMENT/PROCESSING for a given booking at once — enforced by the unique partial
 * index below, not by a read-then-write check in PaymentsService (two simultaneous creates must
 * not both pass a pre-check and both insert; the index makes the second insert fail atomically).
 * A FAILED/CANCELLED row is outside the index's filter, so it may freely coexist with a later one.
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

/**
 * The real "only one in flight per booking" guarantee: a unique index that only covers rows
 * whose status is REQUIRES_PAYMENT or PROCESSING. A second concurrent insert for the same
 * booking while one such row already exists fails atomically at the database with a duplicate
 * key error (E11000) — PaymentsService catches that and turns it into a 409, instead of relying
 * on a check-then-insert that a race could slip through.
 */
PaymentSchema.index(
  { bookingType: 1, bookingId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.PROCESSING] },
    },
  },
);
