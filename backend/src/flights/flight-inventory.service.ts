import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AirlinesService } from '../airlines';
import { CabinClass, FlightStatus } from '../common';
import { Cabin, CabinLean } from './schemas/cabin.schema';
import { Flight, FlightLean } from './schemas/flight.schema';
import { effectiveFlightStatus } from './utils/flight-status';
import { hasAtLeastSeats } from './utils/seat-availability';

/**
 * The only place that changes a cabin's seat counters (FLT-22), so booking code never writes the cabins
 * collection directly. It uses the shared availability filter from FLT-11 (utils/seat-availability.ts). Every method that writes takes the caller's MongoDB session: the booking and the
 * seat counters are changed in ONE transaction (docs/contracts.md section 8).
 */
@Injectable()
export class FlightInventoryService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Cabin.name) private readonly cabins: Model<Cabin>,
    private readonly airlines: AirlinesService,
  ) {}

  /** The flight, if travelers can book it right now: 404 if unknown, 409 if cancelled/departed or its airline is deactivated. */
  async loadBookableFlight(
    flightId: string,
    now: Date = new Date(),
  ): Promise<FlightLean> {
    if (!Types.ObjectId.isValid(flightId)) {
      throw new NotFoundException('Flight not found');
    }
    const flight = await this.flights
      .findById(flightId)
      .lean<FlightLean>()
      .exec();
    if (!flight) throw new NotFoundException('Flight not found');
    // FLT-30: the effective status, so a flight past its departure time is closed even before the status job stores DEPARTED.
    const status = effectiveFlightStatus(flight, now);
    if (status !== FlightStatus.SCHEDULED) {
      throw new ConflictException(
        `This flight is not open for booking (it is ${status})`,
      );
    }
    const airline = await this.airlines.findById(flight.airlineId.toString());
    if (!airline || !airline.isActive) {
      throw new ConflictException('This airline is not open for booking');
    }
    return flight;
  }

  /**
   * Reserve `seats` in one cabin: ONE conditional update ("only if total - booked - held >= seats"),
   * never read-then-write, so parallel requests can never hold more seats than exist.
   * Returns the cabin as it is after the update (the fare in it is the one the booking must use),
   * or null when the cabin does not exist or has too few seats left.
   */
  holdSeats(
    flightId: Types.ObjectId | string,
    cabinClass: CabinClass,
    seats: number,
    session: ClientSession,
  ): Promise<CabinLean | null> {
    return this.cabins
      .findOneAndUpdate(
        { flightId, cabinClass, ...hasAtLeastSeats(seats) },
        { $inc: { heldSeats: seats } },
        { new: true, session },
      )
      .lean<CabinLean>()
      .exec();
  }

  /** Tells "this flight has no such cabin" (404) apart from "no seats left" (409) after holdSeats returned null. */
  async cabinExists(
    flightId: Types.ObjectId | string,
    cabinClass: CabinClass,
    session: ClientSession,
  ): Promise<boolean> {
    const found = await this.cabins
      .exists({ flightId, cabinClass })
      .session(session)
      .exec();
    return found !== null;
  }

  /** A hold expired (or was abandoned): give its seats back. */
  async releaseHeldSeats(
    flightId: Types.ObjectId | string,
    cabinClass: CabinClass,
    seats: number,
    session: ClientSession,
  ): Promise<void> {
    await this.mustUpdate(
      { flightId, cabinClass, heldSeats: { $gte: seats } },
      { $inc: { heldSeats: -seats } },
      session,
      'release held seats',
    );
  }

  /** Payment succeeded: the held seats become booked seats. */
  async confirmHeldSeats(
    flightId: Types.ObjectId | string,
    cabinClass: CabinClass,
    seats: number,
    session: ClientSession,
  ): Promise<void> {
    await this.mustUpdate(
      { flightId, cabinClass, heldSeats: { $gte: seats } },
      { $inc: { heldSeats: -seats, bookedSeats: seats } },
      session,
      'confirm held seats',
    );
  }

  /** A confirmed booking was cancelled: give its booked seats back. */
  async returnBookedSeats(
    flightId: Types.ObjectId | string,
    cabinClass: CabinClass,
    seats: number,
    session: ClientSession,
  ): Promise<void> {
    await this.mustUpdate(
      { flightId, cabinClass, bookedSeats: { $gte: seats } },
      { $inc: { bookedSeats: -seats } },
      session,
      'return booked seats',
    );
  }

  /**
   * The guard in each filter (`heldSeats >= seats`) keeps a counter from ever going below zero. If it does not
   * match, the counters and the booking disagree: throwing aborts the whole transaction so nothing is half-done.
   */
  private async mustUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    session: ClientSession,
    what: string,
  ): Promise<void> {
    const updated = await this.cabins
      .findOneAndUpdate(filter, update, { session })
      .lean<CabinLean>()
      .exec();
    if (!updated) {
      throw new InternalServerErrorException(
        `Seat counters are out of sync: could not ${what}`,
      );
    }
  }
}
