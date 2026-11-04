import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ITINERARY_TITLE_MAX_LENGTH, Visibility } from '../../common';

/**
 * A user's trip plan (collection `itineraries`). Days, activities, budgets and transport costs are added
 * by later tickets as their own collections that point back here with `itineraryId`.
 */
@Schema({ timestamps: true, collection: 'itineraries' })
export class Itinerary {
  /** The owner. Blog (BLG-12) and Reports (GEN-09/10) read this to find an author's itineraries. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: ITINERARY_TITLE_MAX_LENGTH,
  })
  title: string;

  /**
   * Official country codes from the seeded reference data (e.g. "EG"). They are the reference-data ids,
   * so they are stored as given and checked against `ReferenceDataService`, never invented here.
   */
  @Prop({ type: [String], required: true })
  countryCodes: string[];

  /** Date-only `YYYY-MM-DD` (contracts section 3). Day dates are derived from it by later tickets. */
  @Prop({ type: String, required: true })
  startDate: string;

  /** Private by default (ITN-01). ITN-20 adds the endpoint that changes it. */
  @Prop({
    type: String,
    enum: Object.values(Visibility),
    default: Visibility.PRIVATE,
  })
  visibility: Visibility;

  /**
   * Set by an admin through the reports module (GEN-10). Hidden content is returned only to its author
   * and to admins (contracts section 7). Nothing in this module changes it.
   */
  @Prop({ type: Boolean, default: false })
  isHidden: boolean;
}

export type ItineraryDocument = HydratedDocument<Itinerary>;

/** An itinerary as returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type ItineraryLean = Itinerary & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

// "My itineraries, most recently updated first" (ITN-03) filters by author and sorts by updatedAt.
ItinerarySchema.index({ authorId: 1, updatedAt: -1 });
