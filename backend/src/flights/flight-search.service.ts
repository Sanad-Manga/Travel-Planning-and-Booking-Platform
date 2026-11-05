import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AirlinesService } from '../airlines';
import { FlightStatus } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { FlightCabinsReader } from './flight-cabins.reader';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
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
   */
  async search(query: FlightSearchQueryDto): Promise<FlightSearchPageDto> {
    const { departureAirport, arrivalAirport, departureDate, passengers } = query;
    const { page, limit } = query;
    await this.validate(query);

    const flights = await this.model
      .find({
        status: FlightStatus.SCHEDULED,
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
    const cabinsByFlight = await this.cabins.findWithSeats(
      ofActiveAirlines.map((f) => f._id),
      passengers,
    );
    const matches = ofActiveAirlines.filter((f) =>
      cabinsByFlight.has(f._id.toString()),
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