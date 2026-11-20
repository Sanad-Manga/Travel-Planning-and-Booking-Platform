import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Longest activity name and description. Not set by the requirements; safety caps for the stored document. */
export const ACTIVITY_NAME_MAX_LENGTH = 100;
export const ACTIVITY_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * One image attached to an activity (ITN-12): the reference the shared upload service (GEN-08) returned. `id` is the
 * upload id (what `UploadService.remove` takes) and `url` is the public path of the stored file.
 */
@Schema({ _id: false })
export class ActivityImage {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: String, required: true })
  url: string;
}
export const ActivityImageSchema = SchemaFactory.createForClass(ActivityImage);

/**
 * One activity planned for a day of an itinerary (ITN-10), collection `activities`. It lives in its own
 * collection, not inside the day, because the API addresses it by its own id (PATCH/DELETE /api/activities/:id)
 * and because images (ITN-12) and the budget (ITN-14) read activities across days.
 */
@Schema({ timestamps: true, collection: 'activities' })
export class Activity {
  /** The itinerary it belongs to. Deleting the itinerary deletes its activities. */
  @Prop({ type: Types.ObjectId, ref: 'Itinerary', required: true })
  itineraryId: Types.ObjectId;

  /** The `_id` of the embedded day (ITN-05) it is planned for. */
  @Prop({ type: Types.ObjectId, required: true })
  dayId: Types.ObjectId;

  /**
   * The itinerary's author, copied here when the activity is created. An itinerary never changes owner, so
   * the copy cannot go stale. It lets edit and delete check ownership inside ONE atomic update
   * (`_id` AND `ownerId`), with no read of the itinerary first.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: ACTIVITY_NAME_MAX_LENGTH,
  })
  name: string;

  @Prop({
    type: String,
    default: '',
    maxlength: ACTIVITY_DESCRIPTION_MAX_LENGTH,
  })
  description: string;

  /** Optional start time of day, `HH:mm` (24 hours). Absent when not set. */
  @Prop({ type: String })
  time?: string;

  /**
   * Optional cost in integer cents of the platform currency (contracts section 3), never a float.
   * Absent when not set; 0 is a free activity. ITN-14 counts it under "Activities" in the budget.
   */
  @Prop({
    type: Number,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'costCents must be a whole number of cents',
    },
  })
  costCents?: number;

  /**
   * The images attached to the activity (ITN-12), at most 5 (the upload service enforces the limit). Only
   * references are stored here; the files and their count live in the upload service.
   */
  @Prop({ type: [ActivityImageSchema], default: [] })
  images: ActivityImage[];
}

export type ActivityDocument = HydratedDocument<Activity>;

/** An activity as returned by `.lean()`. */
export type ActivityLean = Activity & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const ActivitySchema = SchemaFactory.createForClass(Activity);

// "All activities of an itinerary" (shown on the itinerary, deleted with it) filters on itineraryId; the day
// is read from the same documents.
ActivitySchema.index({ itineraryId: 1, dayId: 1 });
