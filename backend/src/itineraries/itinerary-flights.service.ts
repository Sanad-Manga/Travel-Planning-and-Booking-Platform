import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../common';
import { FlightSearchService } from '../flights/flight-search.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { addDays } from './dto/itinerary-day.dto';
import {
  ItineraryFlightsDto,
  ItineraryFlightDestinationDto,
} from './dto/itinerary-flights-response.dto';
import {
  ItineraryFlightsQueryDto,
  ItineraryTripType,
} from './dto/itinerary-flights-query.dto';
import { Itinerary, ItineraryLean } from './schemas/itinerary.schema';

/** ITN-26: flights to the city of the itinerary's first day, through the flight search (FLT-11, FLT-12). */
@Injectable()
export class ItineraryFlightsService {
  constructor(
    @InjectModel(Itinerary.name) private readonly model: Model<Itinerary>,
    // The FLT-11/FLT-12 flight search, reused as it is (see ItinerariesModule for how it is provided).
    private readonly flightSearch: FlightSearchService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * ITN-26: the owner searches flights from an origin airport they choose to the city their itinerary starts in.
   * The destination is every airport of the city of the first day (the origin airport is left out when it is in that
   * city, because a flight needs two different airports). The outbound date defaults to the itinerary's start date
   * (the date of the first day) and, for a round trip, the return date defaults to the date of the last day; both
   * can be overridden. Each airport is one call of the flight search `FlightSearchService.search`, as it is: this
   * method only turns the itinerary into airports and dates, so the search rules (scheduled flights, active
   * airlines, seats for the passengers, cabin and price filters, sorting, paging, the validation of the dates and
   * of the origin airport) are not written a second time here.
   *
   * Someone else's or an unknown itinerary answers 404. An itinerary without days, or whose first day is in a city
   * without an airport, is a 400 on `id`; a city whose only airport is the origin is a 400 on `departureAirport`;
   * a `returnDate` on a one-way search is a 400 on `returnDate`.
   */
  async flightsForItinerary(
    user: AuthenticatedUser,
    id: string,
    query: ItineraryFlightsQueryDto,
  ): Promise<ItineraryFlightsDto> {
    const itinerary = await this.model
      .findOne({ _id: id, authorId: new Types.ObjectId(user.userId) })
      .lean<ItineraryLean>()
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');

    const days = itinerary.days ?? [];
    if (days.length === 0) {
      throw this.bad(
        'id',
        'the itinerary has no days yet, so it has no city to fly to',
      );
    }
    const {
      tripType: requestedType,
      departureDate,
      returnDate,
      ...search
    } = query;
    // The DTO already defaults it over HTTP; this keeps a direct call of the service on the same default.
    const tripType = requestedType ?? ItineraryTripType.ROUND_TRIP;
    if (tripType === ItineraryTripType.ONE_WAY && returnDate !== undefined) {
      throw this.bad(
        'returnDate',
        'returnDate can only be used for a ROUND_TRIP',
      );
    }

    const destinationCityId = days[0].cityId;
    const airports =
      await this.referenceData.listAirportsByCity(destinationCityId);
    if (airports.length === 0) {
      throw this.bad(
        'id',
        `the city of the first day (${destinationCityId}) has no airport`,
      );
    }
    const destinations = airports.filter(
      (airport) => airport.iata_code !== search.departureAirport,
    );
    if (destinations.length === 0) {
      throw this.bad(
        'departureAirport',
        `${search.departureAirport} is the only airport of ${destinationCityId}, the city of the first day, so there is nowhere to fly to`,
      );
    }

    const outbound = departureDate ?? itinerary.startDate;
    const back =
      tripType === ItineraryTripType.ONE_WAY
        ? undefined
        : (returnDate ?? addDays(itinerary.startDate, days.length - 1));

    const results = await Promise.all(
      destinations.map(
        async (airport): Promise<ItineraryFlightDestinationDto> => ({
          airport: { iataCode: airport.iata_code, name: airport.name },
          results: await this.flightSearch.search({
            ...search,
            arrivalAirport: airport.iata_code,
            departureDate: outbound,
            ...(back !== undefined && { returnDate: back }),
          }),
        }),
      ),
    );

    return {
      tripType,
      departureAirport: search.departureAirport,
      destinationCityId,
      departureDate: outbound,
      returnDate: back ?? null,
      destinations: results,
    };
  }

  private bad(field: string, message: string): BadRequestException {
    return new BadRequestException({
      message: 'Validation failed',
      details: [{ field, message }],
    });
  }
}
