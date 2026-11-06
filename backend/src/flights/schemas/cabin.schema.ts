import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CabinClass } from '../../common';

const wholeNumber = {
  validator: Number.isInteger,
  message: '{PATH} must be a whole number',
};
const greaterThanZero = {
  validator: (value: number) => value > 0,
  message: '{PATH} must be greater than 0',
};

/**
 * One cabin category of one flight (collection `cabins`), FLT-04.
 * Kept separate from the flight so the seat counters can be changed with a single atomic update
 * (see utils/seat-availability.ts; the FLT-22 hold relies on it).
 * SKELETON: DTOs, endpoints, ownership checks and the FLT-05 edit rules come in the next sprint.
 */
@Schema({ timestamps: true, collection: 'cabins' })
export class Cabin {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  /** Fixed set {ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST}; each used at most once per flight. */
  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass: CabinClass;

  /** Seats on sale in this cabin (whole number, > 0). */
  @Prop({ type: Number, required: true, validate: [wholeNumber, greaterThanZero] })
  totalSeats: number;

  /** Seats of confirmed bookings. Changed only by booking code, never by the moderator. */
  @Prop({ type: Number, default: 0, min: 0, validate: wholeNumber })
  bookedSeats: number;

  /** Seats of unexpired holds waiting for payment (FLT-22). Available = total - booked - held. */
  @Prop({ type: Number, default: 0, min: 0, validate: wholeNumber })
  heldSeats: number;

  /** Per-passenger fare in integer cents (contract: money is stored as ...Cents), > 0. */
  @Prop({ type: Number, required: true, validate: [wholeNumber, greaterThanZero] })
  priceCents: number;

  /** Free checked bags per passenger (a count; 0 is allowed). */
  @Prop({ type: Number, required: true, min: 0, validate: wholeNumber })
  freeBags: number;

  /** Maximum weight in kg per bag, also the limit for extra bags (FLT-08). */
  @Prop({ type: Number, required: true, validate: greaterThanZero })
  maxBagWeightKg: number;
}

export type CabinDocument = HydratedDocument<Cabin>;

/** A cabin as returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type CabinLean = Cabin & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const CabinSchema = SchemaFactory.createForClass(Cabin);

// FLT-04: each cabin class at most once per flight (409 on a duplicate); also serves lookups by flight.
CabinSchema.index({ flightId: 1, cabinClass: 1 }, { unique: true });