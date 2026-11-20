import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ContentType, ReportStatus } from '../../common';

/**
 * Collection `reports` (GEN-09). One row = one user's report of one post, comment, review or itinerary.
 * The admin listing and the hide/dismiss/delete actions (GEN-10) read and move `status`; do not rename these
 * fields without telling that ticket's owner.
 */
@Schema({ collection: 'reports', timestamps: true })
export class Report {
  /** Always the logged-in user, never taken from the request body. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  reporterId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(ContentType), required: true })
  targetType: ContentType;

  /** The _id of the reported item in its own collection (posts, comments, reviews, itineraries). */
  @Prop({ type: Types.ObjectId, required: true })
  targetId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  reason: string;

  @Prop({
    type: String,
    enum: Object.values(ReportStatus),
    required: true,
    default: ReportStatus.OPEN,
  })
  status: ReportStatus;

  createdAt?: Date;
  updatedAt?: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);

// At most one report per item per user. This index, not a read-then-write check, is what holds under parallel requests.
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
// The admin listing (GEN-10) filters by status and shows the newest first.
ReportSchema.index({ status: 1, createdAt: -1 });
