import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * How the traveller gets from one city to the next (ITN-16). The requirements only say "mode", so these are the
 * usual intercity options; there is no shared enum for it in `common`.
 */
export enum TransportMode {
  FLIGHT = 'FLIGHT',
  TRAIN = 'TRAIN',
  BUS = 'BUS',
  CAR = 'CAR',
  FERRY = 'FERRY',
  OTHER = 'OTHER',
}

/**
 * One intercity transport cost of an itinerary (ITN-16), collection `transportCosts`. It has its own collection
 * because the API addresses it by its own id (PATCH/DELETE /api/transport-costs/:id) and the budget (ITN-14)
 * adds the entries up.
 */
@Schema({ timestamps: true, collection: 'transportCosts' })
export class TransportCost {
  /** The itinerary it belongs to. Deleting the itinerary deletes its entries. */
  @Prop({ type: Types.ObjectId, ref: 'Itinerary', required: true })
  itineraryId: Types.ObjectId;

  /** The `_id` of the embedded day (ITN-05) of that itinerary the trip is on. */
  @Prop({ type: Types.ObjectId, required: true })
  dayId: Types.ObjectId;

  /**
   * The itinerary's author, copied here when the entry is created. An itinerary never changes owner, so the copy
   * cannot go stale. It lets edit and delete check ownership inside ONE atomic query (`_id` AND `ownerId`).
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(TransportMode), required: true })
  mode: TransportMode;

  /** Official `city_id` values from the seeded reference data (GEN-12), e.g. "cairo". */
  @Prop({ type: String, required: true })
  fromCityId: string;

  @Prop({ type: String, required: true })
  toCityId: string;

  /** Integer cents (contracts section 3), never a float. 0 is allowed. */
  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'amountCents must be a whole number of cents',
    },
  })
  amountCents: number;

  /** A supported currency code (GEN-12 seeds them from Countries.csv), e.g. "USD". ITN-18 converts it. */
  @Prop({ type: String, required: true })
  currency: string;
}

export type TransportCostDocument = HydratedDocument<TransportCost>;

/** An entry as returned by `.lean()`. */
export type TransportCostLean = TransportCost & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);

// "All entries of an itinerary" (shown on the itinerary, deleted with it, summed by the budget).
TransportCostSchema.index({ itineraryId: 1 });
