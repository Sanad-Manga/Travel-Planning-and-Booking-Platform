import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingType } from '../../common';

/**
 * PAY-02: records that the booking's owner accepted the provider's policies before paying.
 * Owned by Payments (not a field on `FlightBooking`/a future `HotelBooking`, per
 * docs/contracts.md section 1 — Payments does not edit another module's schema).
 * Re-accepting the same booking is an upsert (idempotent), never a duplicate.
 */
@Schema({ timestamps: true, collection: 'policyAcceptances' })
export class PolicyAcceptance {
  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Date, required: true, default: Date.now })
  acceptedAt: Date;
}

export type PolicyAcceptanceDocument = HydratedDocument<PolicyAcceptance>;

/** As returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type PolicyAcceptanceLean = PolicyAcceptance & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const PolicyAcceptanceSchema =
  SchemaFactory.createForClass(PolicyAcceptance);
PolicyAcceptanceSchema.index(
  { bookingType: 1, bookingId: 1, userId: 1 },
  { unique: true },
);
