import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AirlinesService } from '../airlines';
import { FlightStatus } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CabinOption, FlightCabinsReader } from './flight-cabins.reader';
import {
  FlightSearchQueryDto,
  FlightSortBy,
  FlightSortOrder,
} from './dto/flight-search-query.dto';
import {
  FlightSearchPageDto,
  SearchAirlineDto,
  toFlightSearchItem,
} from './dto/flight-search-response.dto';
import { Flight, FlightLean } from './schemas/flight.schema';

interface FieldError {
  field: string;
  message: string;
}

const isRealDate = (text: string): boolean => {
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
};

@Injectable()
export class FlightSearchService {
  constructor(
    @InjectModel(Flight.name) private readonly model: Model<Flight>,
    private readonly airlines: AirlinesService,
    private readonly referenceData: ReferenceDataService,
    private readonly cabins: FlightCabinsReader,
  ) {}

  /**
   * FLT-11: SCHEDULED flights of ACTIVE airlines on the local departure date that still have enough
   * seats (total - booked - held) in at least one cabin. An empty result is a normal 200, not an error.
   * Date match uses the stored `departureLocalDate` (the local date at the departure airport), so no
   * time-zone conversion is needed here.
   *
   * FLT-15: optional inclusive price range (applied per cabin fare, in cents, together with the seat
   * check) and sorting by price, duration or departure time. All other criteria still apply.
   */
  async search(
    query: FlightSearchQueryDto,
    now: Date = new Date(),
  ): Promise<FlightSearchPageDto> {
    const { departureAirport, arrivalAirport, departureDate, passengers } = query;
    const { page, limit } = query;
    await this.validate(query);

    const flights = await this.model
      .find({
        status: FlightStatus.SCHEDULED,
        // FLT-30: a flight that has left is not searchable even before the status job has stored DEPARTED.
        departureAt: { $gt: now },
        departureAirport,
        arrivalAirport,
        departureLocalDate: departureDate,
      })
      .sort({ departureAt: 1, _id: 1 })
      .lean<FlightLean[]>()
      .exec();

    const airlinesById = await this.activeAirlines(flights);
    const ofActiveAirlines = flights.filter((f) =>
      airlinesById.has(f.airlineId.toString()),
    );
    const cabinsWithSeats = await this.cabins.findWithSeats(
      ofActiveAirlines.map((f) => f._id),
      passengers,
    );
    const cabinsByFlight = this.inPriceRange(
      cabinsWithSeats,
      query.minPrice,
      query.maxPrice,
    );
    const matches = this.sortMatches(
      ofActiveAirlines.filter((f) => cabinsByFlight.has(f._id.toString())),
      cabinsByFlight,
      query.sort,
      query.order,
    );

    const items = matches
      .slice((page - 1) * limit, page * limit)
      .map((f) =>
        toFlightSearchItem(
          f,
          airlinesById.get(f.airlineId.toString())!,
          cabinsByFlight.get(f._id.toString())!,
        ),
      );
    return {
      items,
      page,
      limit,
      total: matches.length,
      totalPages: Math.ceil(matches.length / limit),
    };
  }

  /** FLT-15: keeps only cabins whose fare is within the inclusive range; a flight with none left is dropped. */
  private inPriceRange(
    cabinsByFlight: Map<string, CabinOption[]>,
    minPrice?: number,
    maxPrice?: number,
  ): Map<string, CabinOption[]> {
    if (minPrice === undefined && maxPrice === undefined) return cabinsByFlight;
    const filtered = new Map<string, CabinOption[]>();
    for (const [flightId, options] of cabinsByFlight) {
      const kept = options.filter(
        (c) =>
          (minPrice === undefined || c.priceCents >= minPrice) &&
          (maxPrice === undefined || c.priceCents <= maxPrice),
      );
      if (kept.length > 0) filtered.set(flightId, kept);
    }
    return filtered;
  }

  /**
   * FLT-15: price = cheapest cabin that matched; duration = arrival - departure (both UTC, so it is
   * correct across time zones); departureTime = departure instant. Ties fall back to departure time,
   * then id, so the order (and pagination) is always stable.
   */
  private sortMatches(
    flights: FlightLean[],
    cabinsByFlight: Map<string, CabinOption[]>,
    sort: FlightSortBy,
    order: FlightSortOrder,
  ): FlightLean[] {
    const direction = order === FlightSortOrder.DESC ? -1 : 1;
    const keyOf = (f: FlightLean): number => {
      switch (sort) {
        case FlightSortBy.PRICE:
          return Math.min(
            ...cabinsByFlight.get(f._id.toString())!.map((c) => c.priceCents),
          );
        case FlightSortBy.DURATION:
          return f.arrivalAt.getTime() - f.departureAt.getTime();
        default:
          return f.departureAt.getTime();
      }
    };
    return [...flights].sort(
      (a, b) =>
        (keyOf(a) - keyOf(b)) * direction ||
        a.departureAt.getTime() - b.departureAt.getTime() ||
        a._id.toString().localeCompare(b._id.toString()),
    );
  }

  private async activeAirlines(
    flights: FlightLean[],
  ): Promise<Map<string, SearchAirlineDto>> {
    const ids = [...new Set(flights.map((f) => f.airlineId.toString()))];
    const found = await Promise.all(ids.map((id) => this.airlines.findById(id)));
    const active = new Map<string, SearchAirlineDto>();
    for (const airline of found) {
      if (airline && airline.isActive) {
        const id = airline._id.toString();
        active.set(id, { id, name: airline.name, code: airline.code });
      }
    }
    return active;
  }

  private async validate(query: FlightSearchQueryDto): Promise<void> {
    const errors: FieldError[] = [];
    if (!isRealDate(query.departureDate)) {
      errors.push({
        field: 'departureDate',
        message: 'departureDate must be a real calendar date (YYYY-MM-DD)',
      });
    }
    if (query.departureAirport === query.arrivalAirport) {
      errors.push({
        field: 'arrivalAirport',
        message: 'arrivalAirport must be different from departureAirport',
      });
    }
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      errors.push({
        field: 'minPrice',
        message: 'minPrice must not be greater than maxPrice',
      });
    }
    const [departure, arrival] = await Promise.all([
      this.referenceData.findAirportById(query.departureAirport),
      this.referenceData.findAirportById(query.arrivalAirport),
    ]);
    if (!departure) {
      errors.push({
        field: 'departureAirport',
        message: 'departureAirport must be an airport from the seeded list',
      });
    }
    if (!arrival) {
      errors.push({
        field: 'arrivalAirport',
        message: 'arrivalAirport must be an airport from the seeded list',
      });
    }
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', details: errors });
    }
  }
}
