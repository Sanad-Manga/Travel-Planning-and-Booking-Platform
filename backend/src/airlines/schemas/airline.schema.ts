import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Extra-baggage rules of an airline (FLT-08). Embedded, no own collection. */
@Schema({ _id: false })
export class BaggagePolicy {
  /** Price of one extra bag in integer cents (> 0). */
  @Prop({ type: Number, required: true, min: 1 })
  extraBagPriceCents: number;

  /** Most extra bags one passenger may add (>= 0; 0 means none offered). */
  @Prop({ type: Number, required: true, min: 0 })
  maxExtraBags: number;
}

export const BaggagePolicySchema = SchemaFactory.createForClass(BaggagePolicy);

/**
 * An airline (collection `airlines`). Flights (FLT-03) and moderators (users.airlineId) reference it by `_id`.
 */
@Schema({ timestamps: true, collection: 'airlines' })
export class Airline {
  @Prop({ type: String, required: true, trim: true })
  name: string;

  /** Airline designator, e.g. "MS". Stored upper-case; unique across the platform. */
  @Prop({ type: String, required: true, trim: true, uppercase: true })
  code: string;

  /**
   * One logo per airline. STUB until the upload service (GEN-08) merges: for now this is a plain
   * http(s) URL the moderator supplies. It will be replaced by the id/url returned by `UploadService.save`.
   */
  @Prop({ type: String, trim: true })
  logoUrl?: string;

  /**
   * Admin can deactivate a provider (ACC-15). Deactivated airlines are hidden from flight search and
   * cannot be booked. Nothing in this module changes the flag; the Admin module owns that endpoint.
   */
  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  /** Extra-baggage price and limit (FLT-08). Absent until the moderator sets it. */
  @Prop({ type: BaggagePolicySchema })
  baggagePolicy?: BaggagePolicy;
}

export type AirlineDocument = HydratedDocument<Airline>;

/** An airline as returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type AirlineLean = Airline & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const AirlineSchema = SchemaFactory.createForClass(Airline);

// No two airlines share a code (409 on a duplicate).
AirlineSchema.index({ code: 1 }, { unique: true });
