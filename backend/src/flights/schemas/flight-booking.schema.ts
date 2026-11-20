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

@Schema({ _id: false })
export class FlightBookingSegment {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass: CabinClass;

  @Prop({ type: Number, required: true, min: 1 })
  seats: number;

  @Prop({ type: Number, required: true, min: 0 })
  farePerPassengerCents: number;

  @Prop({ type: Number, required: true, min: 0 })
  infantFareCents: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  baggageFeeCents: number;
}
const FlightBookingSegmentSchema =
  SchemaFactory.createForClass(FlightBookingSegment);

/** FLT-28: the seat a passenger chose on one flight of the booking. */
@Schema({ _id: false })
export class FlightSeatSelection {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  /** Index into `passengers`. */
  @Prop({ type: Number, required: true, min: 0 })
  passengerIndex: number;

  /** Seat label in the booked cabin, e.g. "12A". */
  @Prop({ type: String, required: true })
  seat: string;
}
const FlightSeatSelectionSchema =
  SchemaFactory.createForClass(FlightSeatSelection);

/**
 * A flight booking (collection `flightBookings`). FLT-22 creates it as PENDING_PAYMENT with the seats held;
 * the status only ever changes through BookingLifecycle (docs/contracts.md section 5).
 * A round trip is one booking with one or two independently priced, inventory-backed segments (FLT-12).
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

  /** Outbound first; the return leg, when present, is second. */
  @Prop({ type: [FlightBookingSegmentSchema], default: undefined })
  segments?: FlightBookingSegment[];

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

  /**
   * FLT-23: assigned exactly once, in the same atomic confirmation that stores `paymentRef`.
   * A confirmed booking keeps this reference for life; historical bookings confirmed before
   * FLT-23 keep none (the sparse unique index tolerates the missing field).
   */
  @Prop({ type: String })
  bookingReference?: string;

  /**
   * FLT-28: seats the traveler picked (at most one per passenger per flight), written only by
   * FlightSeatSelectionService after the seat was claimed in `flightSeatClaims`. Absent until a seat is chosen.
   */
  @Prop({ type: [FlightSeatSelectionSchema], default: undefined })
  seatSelections?: FlightSeatSelection[];

  /**
   * FLT-26: what this cancellation refunds, recorded just before the status becomes CANCELLED
   * (0 when no tier applies). If issuing the refund then fails, cancelling again issues exactly
   * this amount instead of recalculating it from a policy that may have changed.
   */
  @Prop({ type: Number, min: 0 })
  cancellationRefundCents?: number;

  /** FLT-26: when the traveler asked to cancel; written with the amount above. */
  @Prop({ type: Date })
  cancellationRequestedAt?: Date;
}

export type FlightBookingDocument = HydratedDocument<FlightBooking>;

/** A booking as returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type FlightBookingLean = FlightBooking & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export function getFlightBookingSegments(
  booking: Pick<
    FlightBooking,
    | 'segments'
    | 'flightId'
    | 'airlineId'
    | 'cabinClass'
    | 'seats'
    | 'farePerPassengerCents'
    | 'infantFareCents'
    | 'baggageFeeCents'
  >,
): FlightBookingSegment[] {
  if (booking.segments?.length) return booking.segments;
  return [
    {
      flightId: booking.flightId,
      airlineId: booking.airlineId,
      cabinClass: booking.cabinClass,
      seats: booking.seats,
      farePerPassengerCents: booking.farePerPassengerCents,
      infantFareCents: booking.infantFareCents,
      baggageFeeCents: booking.baggageFeeCents,
    },
  ];
}

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

// "My bookings" lists (FLT-25), newest first.
FlightBookingSchema.index({ userId: 1, createdAt: -1 });
// The hold-expiry sweep: PENDING_PAYMENT bookings whose hold ran out, in _id order (cursor).
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1, _id: 1 });
// FLT-23: two confirmed bookings can never share a reference; unconfirmed/legacy bookings are excluded.
FlightBookingSchema.index(
  { bookingReference: 1 },
  { unique: true, sparse: true },
);
