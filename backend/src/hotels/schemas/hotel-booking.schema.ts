import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingStatus } from '../../common';

@Schema({ _id: false })
export class HotelBookingRoom {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  adults: number;

  @Prop({ required: true, min: 0 })
  children: number;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  type: string;

  @Prop({ required: true, min: 1 })
  maxOccupancy: number;

  @Prop({ required: true, min: 1 })
  pricePerNightCents: number;

  @Prop({ required: true, min: 1 })
  totalCents: number;
}
const HotelBookingRoomSchema = SchemaFactory.createForClass(HotelBookingRoom);

/** A hotel reservation and its room-price snapshots. */
@Schema({ collection: 'hotelBookings', timestamps: true })
export class HotelBooking {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  @Prop({ required: true })
  checkIn: string;

  @Prop({ required: true })
  checkOut: string;

  @Prop({ type: [HotelBookingRoomSchema], required: true, validate: (rooms: HotelBookingRoom[]) => rooms.length > 0 })
  rooms: HotelBookingRoom[];

  @Prop({ required: true, min: 1 })
  nights: number;

  @Prop({ required: true, min: 1 })
  totalCents: number;

  @Prop({ required: true })
  currency: string;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PENDING_PAYMENT,
    required: true,
  })
  status: BookingStatus;

  /** Present while payment is pending; its expiry is managed by BookingLifecycle. */
  @Prop({ type: Date })
  holdExpiresAt?: Date;

  @Prop({ type: String })
  paymentRef?: string;

  /** Assigned when payment confirms the reservation. */
  @Prop({ type: String })
  bookingReference?: string;
}

export type HotelBookingDocument = HydratedDocument<HotelBooking>;
export type HotelBookingLean = HotelBooking & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);

HotelBookingSchema.index({ userId: 1, status: 1, checkIn: 1 });
HotelBookingSchema.index({ 'rooms.roomId': 1, status: 1, checkIn: 1, checkOut: 1 });
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1, _id: 1 });
HotelBookingSchema.index({ bookingReference: 1 }, { unique: true, sparse: true });
