import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ITINERARY_TITLE_MAX_LENGTH, Visibility } from '../../common';

/**
 * One day of an itinerary (ITN-05), embedded in the itinerary. Its number and date are NOT stored: day N is
 * the element at index N-1 and its date is the start date + (N-1) days, so numbering is always sequential
 * and dates follow any change of the start date or of the order (ITN-07 delete, ITN-08 move) by themselves.
 */
@Schema({ _id: true })
export class ItineraryDay {
  /** Official `city_id` from the seeded reference data (shared with hotels and airports), e.g. "cairo". */
  @Prop({ type: String, required: true })
  cityId: string;

  @Prop({ type: String, default: '' })
  notes: string;
}

export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);

/** A day as returned by `.lean()`. */
export type ItineraryDayLean = ItineraryDay & { _id: Types.ObjectId };

/**
 * A user's trip plan (collection `itineraries`). Days are embedded (bounded child data: at most 60).
 * Activities, budgets and transport costs are added by later tickets.
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

  /** Date-only `YYYY-MM-DD` (contracts section 3). Day dates are derived from it (ITN-05). */
  @Prop({ type: String, required: true })
  startDate: string;

  /** Private by default (ITN-01). The owner changes it with PATCH /api/itineraries/:id (ITN-20). */
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

  /** In day order (ITN-05). At most ITINERARY_MAX_DAYS, enforced atomically by the service when adding. */
  @Prop({ type: [ItineraryDaySchema], default: [] })
  days: ItineraryDay[];
}

export type ItineraryDocument = HydratedDocument<Itinerary>;

/**
 * An itinerary as returned by `.lean()` (timestamps: true adds createdAt / updatedAt). `days` may be
 * missing on documents saved before ITN-05 (lean reads skip schema defaults), so readers use `?? []`.
 */
export type ItineraryLean = Omit<Itinerary, 'days'> & {
  _id: Types.ObjectId;
  days?: ItineraryDayLean[];
  createdAt: Date;
  updatedAt: Date;
};

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

// "My itineraries, most recently updated first" (ITN-03) filters by author and sorts by updatedAt.
ItinerarySchema.index({ authorId: 1, updatedAt: -1 });
// The shared search (ITN-20) filters on visibility and the hidden flag and sorts by updatedAt.
ItinerarySchema.index({ visibility: 1, isHidden: 1, updatedAt: -1 });
