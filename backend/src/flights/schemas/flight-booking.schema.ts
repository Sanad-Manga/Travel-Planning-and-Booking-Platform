import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingStatus, CabinClass, PassengerType } from '../../common';

/** How many passengers of each type the booking was held for (details come with FLT-19). */
@Schema({ _id: false })
export class PassengerCounts {
  @Prop({ type: Number, required: true, min: 1 })
  adults: number;

  @Prop({ type: Number, required: true, min: 0 })
  children: number;

  /** Infants take no seat and pay INFANT_FARE_PERCENT of the fare. */
  @Prop({ type: Number, required: true, min: 0 })
  infants: number;
}
const PassengerCountsSchema = SchemaFactory.createForClass(PassengerCounts);

@Schema({ _id: false })
export class ExtraBag {
  @Prop({ type: Number, required: true, min: 0.01 })
  weightKg: number;
}
const ExtraBagSchema = SchemaFactory.createForClass(ExtraBag);

@Schema({ _id: false })
export class BookingPassenger {
  @Prop({ type: String, required: true, trim: true })
  fullName: string;

  /** Date of birth as YYYY-MM-DD; passenger type is derived for the flight's local departure date. */
  @Prop({ type: String, required: true })
  dateOfBirth: string;

  /** Stored for the booking, but excluded from booking response DTOs. */
  @Prop({ type: String, required: true, select: false })
  passportOrIdNumber: string;

  @Prop({ type: String, enum: Object.values(PassengerType), required: true })
  passengerType: PassengerType;

  @Prop({ type: [ExtraBagSchema], default: [] })
  extraBags: ExtraBag[];

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  baggageFeeCents: number;
}
const BookingPassengerSchema = SchemaFactory.createForClass(BookingPassenger);

/**
 * A flight booking (collection `flightBookings`). FLT-22 creates it as PENDING_PAYMENT with the seats held;
 * the status only ever changes through BookingLifecycle (docs/contracts.md section 5).
 * Passenger details, baggage and the return flight are added by later tickets (FLT-19, FLT-12).
 */
@Schema({ timestamps: true, collection: 'flightBookings' })
export class FlightBooking {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** Copied from the flight so airline moderators can list their bookings (ownership helper). */
  @Prop({ type: Types.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass: CabinClass;

  @Prop({ type: PassengerCountsSchema, required: true })
  passengerCounts: PassengerCounts;

  /** FLT-19 details; absent on legacy bookings created through the FLT-22 hold endpoint. */
  @Prop({ type: [BookingPassengerSchema], default: undefined })
  passengers?: BookingPassenger[];

  /** Seats held in the cabin: adults + children (infants take none). */
  @Prop({ type: Number, required: true, min: 1 })
  seats: number;

  /** The cabin fare per adult/child when the seats were held (a later fare change does not affect this booking). */
  @Prop({ type: Number, required: true, min: 0 })
  farePerPassengerCents: number;

  @Prop({ type: Number, required: true, min: 0 })
  infantFareCents: number;

  /** Amount to pay, integer cents in the platform currency. */
  @Prop({ type: Number, required: true, min: 0 })
  totalCents: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  baggageFeeCents: number;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PENDING_PAYMENT,
    required: true,
  })
  status: BookingStatus;

  /** Only set while the booking waits for payment. */
  @Prop({ type: Date })
  holdExpiresAt?: Date;

  /** Set when the payment is confirmed (PAY-01). */
  @Prop({ type: String })
  paymentRef?: string;
}

export type FlightBookingDocument = HydratedDocument<FlightBooking>;

/** A booking as returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type FlightBookingLean = FlightBooking & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

// "My bookings" lists (FLT-25), newest first.
FlightBookingSchema.index({ userId: 1, createdAt: -1 });
// The hold-expiry sweep: PENDING_PAYMENT bookings whose hold ran out, in _id order (cursor).
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1, _id: 1 });
