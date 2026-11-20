import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingType } from '../../common';

/**
 * A confirmed flight or hotel booking linked to one day of an itinerary (ITN-27), collection `itineraryBookings`.
 * It stores only the link and the amount the booking cost when it was linked (a snapshot, so reading the budget does
 * not depend on the other modules' collections). Whether the booking still counts is read from its owner's booking
 * provider every time the budget is added up, so a booking cancelled later stops counting by itself.
 */
@Schema({ timestamps: true, collection: 'itineraryBookings' })
export class ItineraryBooking {
  @Prop({ type: Types.ObjectId, ref: 'Itinerary', required: true })
  itineraryId: Types.ObjectId;

  /** The `_id` of the embedded day (ITN-05) the booking is linked to. Deleting the day deletes the link. */
  @Prop({ type: Types.ObjectId, required: true })
  dayId: Types.ObjectId;

  /** The itinerary's author, who is also the booking's owner (checked when linking). */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(BookingType), required: true })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  /** The booking total in integer cents of `currency`, as it was when the booking was linked. */
  @Prop({ type: Number, required: true, min: 0 })
  amountCents: number;

  @Prop({ type: String, required: true })
  currency: string;
}

export type ItineraryBookingDocument = HydratedDocument<ItineraryBooking>;

/** A link as returned by `.lean()`. */
export type ItineraryBookingLean = ItineraryBooking & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const ItineraryBookingSchema =
  SchemaFactory.createForClass(ItineraryBooking);

// A booking is linked to an itinerary at most once, whatever the day: this is what stops it being counted twice, and it
// is atomic (two simultaneous requests cannot both insert).
ItineraryBookingSchema.index(
  { itineraryId: 1, bookingType: 1, bookingId: 1 },
  { unique: true },
);
// "All links of an itinerary" (the budget) and "all links of a day" (deleted with the day).
ItineraryBookingSchema.index({ itineraryId: 1, dayId: 1 });
