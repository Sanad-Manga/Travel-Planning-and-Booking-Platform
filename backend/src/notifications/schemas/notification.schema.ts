import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { NotificationType } from '../../common';

@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  /** The user who receives it (a reference to the users collection). */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(NotificationType), required: true })
  type: NotificationType;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, required: true, trim: true })
  message: string;

  /** Optional app path the client opens when the notification is clicked. */
  @Prop({ type: String, trim: true })
  link?: string;

  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop({ type: Date })
  readAt?: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;

/** A notification as returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type NotificationLean = Notification & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// "my notifications, newest first" and "my unread notifications / count"
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
