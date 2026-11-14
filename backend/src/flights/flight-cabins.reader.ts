import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CabinClass } from '../common';
import { Cabin, CabinLean } from './schemas/cabin.schema';
import { availableSeats, hasAtLeastSeats } from './utils/seat-availability';

export interface CabinOption {
  cabinClass: CabinClass;
  priceCents: number;
  availableSeats: number;
}

export interface FlightCabinDetails extends CabinOption {
  freeBags: number;
  maxBagWeightKg: number;
}

/** Reads cabins for flight search (FLT-11, FLT-15). */
@Injectable()
export class FlightCabinsReader {
  constructor(@InjectModel(Cabin.name) private readonly model: Model<Cabin>) {}

  /** All cabins for a flight, including sold-out cabins, ordered by price then class. */
  async findForFlight(flightId: Types.ObjectId): Promise<FlightCabinDetails[]> {
    const rows = await this.model
      .find({ flightId })
      .sort({ priceCents: 1, cabinClass: 1 })
      .lean<CabinLean[]>()
      .exec();

    return rows.map((row) => ({
      cabinClass: row.cabinClass,
      priceCents: row.priceCents,
      availableSeats: availableSeats(row),
      freeBags: row.freeBags,
      maxBagWeightKg: row.maxBagWeightKg,
    }));
  }

  /** Cabins with at least `seats` available, grouped by flight id, cheapest first. */
  async findWithSeats(
    flightIds: Types.ObjectId[],
    seats: number,
  ): Promise<Map<string, CabinOption[]>> {
    const byFlight = new Map<string, CabinOption[]>();
    if (flightIds.length === 0) return byFlight;

    const rows = await this.model
      .find({ flightId: { $in: flightIds }, ...hasAtLeastSeats(seats) })
      .sort({ priceCents: 1 })
      .lean<CabinLean[]>()
      .exec();

    for (const row of rows) {
      const key = row.flightId.toString();
      const options = byFlight.get(key) ?? [];
      options.push({
        cabinClass: row.cabinClass,
        priceCents: row.priceCents,
        availableSeats: availableSeats(row),
      });
      byFlight.set(key, options);
    }
    return byFlight;
  }
}
