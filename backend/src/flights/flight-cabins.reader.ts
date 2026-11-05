import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { CabinClass } from '../common';
import {
  availableSeats,
  hasAtLeastSeats,
  SeatCounts,
} from './utils/seat-availability';

export interface CabinOption {
  cabinClass: CabinClass;
  priceCents: number;
  availableSeats: number;
}

type CabinRow = SeatCounts & {
  flightId: Types.ObjectId;
  cabinClass: CabinClass;
  priceCents: number;
};

/**
 * TEMPORARY (until FLT-04 merges): reads the `cabins` collection directly using the field names agreed
 * with the flights owner. Replace the body with the cabin model; keep the signature.
 */
@Injectable()
export class FlightCabinsReader {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Cabins with at least `seats` available, grouped by flight id, cheapest first. */
  async findWithSeats(
    flightIds: Types.ObjectId[],
    seats: number,
  ): Promise<Map<string, CabinOption[]>> {
    const byFlight = new Map<string, CabinOption[]>();
    if (flightIds.length === 0) return byFlight;

    const rows = await this.connection
      .collection<CabinRow>('cabins')
      .find({ flightId: { $in: flightIds }, ...hasAtLeastSeats(seats) })
      .sort({ priceCents: 1 })
      .toArray();

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