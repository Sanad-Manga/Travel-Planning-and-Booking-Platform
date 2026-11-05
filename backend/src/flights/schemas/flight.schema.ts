import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { FlightStatus } from '../../common';

/**
 * A scheduled flight (collection `flights`), created by an airline moderator (FLT-03).
 * Times are stored in UTC. The airports' IANA zones are copied onto the flight so clients can show local
 * time without another lookup (docs/contracts.md section 3).
 * Cabins, seats and prices are added by later tickets (FLT-04 and following).
 */
@Schema({ timestamps: true, collection: 'flights' })
export class Flight {
  @Prop({ type: Types.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;

  /** Upper-case, e.g. "MS777". Unique per airline per local departure date. */
  @Prop({ type: String, required: true, trim: true, uppercase: true })
  flightNumber: string;

  /** IATA code of a seeded airport (reference data). */
  @Prop({ type: String, required: true, uppercase: true })
  departureAirport: string;

  @Prop({ type: String, required: true, uppercase: true })
  arrivalAirport: string;

  @Prop({ type: Date, required: true })
  departureAt: Date;

  @Prop({ type: Date, required: true })
  arrivalAt: Date;

  @Prop({ type: String, required: true })
  departureTimeZone: string;

  @Prop({ type: String, required: true })
  arrivalTimeZone: string;

  /** Departure DATE at the departure airport (`YYYY-MM-DD`): what "the same departure date" means for duplicates. */
  @Prop({ type: String, required: true })
  departureLocalDate: string;

  @Prop({
    type: String,
    enum: Object.values(FlightStatus),
    default: FlightStatus.SCHEDULED,
    required: true,
  })
  status: FlightStatus;
}

export type FlightDocument = HydratedDocument<Flight>;

/** A flight as returned by `.lean()` (timestamps: true adds createdAt / updatedAt). */
export type FlightLean = Flight & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const FlightSchema = SchemaFactory.createForClass(Flight);

// FLT-03: the same airline cannot publish the same flight number twice on one departure date.
FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
  { unique: true },
);
// Search (FLT-11) filters by route and date and only shows scheduled flights.
FlightSchema.index({
  status: 1,
  departureAirport: 1,
  arrivalAirport: 1,
  departureAt: 1,
});
