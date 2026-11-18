import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'hotelReviews', timestamps: true })
export class HotelReview {
  @Prop({ type: Types.ObjectId, ref: 'HotelBooking', required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ type: String, trim: true, default: '' })
  comment: string;

  @Prop({ type: Boolean, default: false })
  isHidden: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type HotelReviewDocument = HydratedDocument<HotelReview>;
export type HotelReviewLean = HotelReview & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const HotelReviewSchema = SchemaFactory.createForClass(HotelReview);

HotelReviewSchema.index({ bookingId: 1 }, { unique: true });
HotelReviewSchema.index({ hotelId: 1, isHidden: 1, createdAt: -1, _id: -1 });
HotelReviewSchema.index({ authorId: 1, createdAt: -1 });
