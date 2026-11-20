import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CabinClass } from '../../common';

/**
 * FLT-28: one chosen seat of one flight (collection `flightSeatClaims`). The unique index on
 * `{ flightId, cabinClass, seat }` is what makes "two travelers cannot take the same seat" hold under parallel
 * requests: the second insert fails with a duplicate key, there is no read-then-write. A claim whose booking is no
 * longer CONFIRMED (cancelled, expired, completed) is stale and is replaced by the next traveler who wants the seat.
 */
@Schema({ timestamps: true, collection: 'flightSeatClaims' })
export class FlightSeatClaim {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass: CabinClass;

  /** Seat label such as "12A". */
  @Prop({ type: String, required: true })
  seat: string;

  @Prop({ type: Types.ObjectId, ref: 'FlightBooking', required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  passengerIndex: number;
}

export type FlightSeatClaimDocument = HydratedDocument<FlightSeatClaim>;
export type FlightSeatClaimLean = FlightSeatClaim & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const FlightSeatClaimSchema =
  SchemaFactory.createForClass(FlightSeatClaim);

FlightSeatClaimSchema.index(
  { flightId: 1, cabinClass: 1, seat: 1 },
  { unique: true },
);
// Releasing / looking up the seats of one booking.
FlightSeatClaimSchema.index({ bookingId: 1 });
