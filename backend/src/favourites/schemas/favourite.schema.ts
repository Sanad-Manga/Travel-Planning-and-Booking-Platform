import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** What can be saved (BON-02). Local to this module: no shared enum covers hotels and itineraries together. */
export enum FavouriteType {
  HOTEL = 'HOTEL',
  ITINERARY = 'ITINERARY',
}

/**
 * Collection `favourites`: one row per (user, type, item). Hotels and itineraries are referenced by id only;
 * their data stays in their own modules.
 */
@Schema({ collection: 'favourites', timestamps: true })
export class Favourite {
  // Always the logged-in user, never taken from the request.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(FavouriteType), required: true })
  type: FavouriteType;

  // hotels._id or itineraries._id, depending on `type`.
  @Prop({ type: Types.ObjectId, required: true })
  itemId: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

export type FavouriteDocument = HydratedDocument<Favourite>;
export const FavouriteSchema = SchemaFactory.createForClass(Favourite);

// The same item can be saved only once per user, even by two requests at the same time.
FavouriteSchema.index({ userId: 1, type: 1, itemId: 1 }, { unique: true });
// "My favourites", newest first.
FavouriteSchema.index({ userId: 1, createdAt: -1 });
