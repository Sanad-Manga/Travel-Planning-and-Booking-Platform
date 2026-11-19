import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Model, PipelineStage, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import {
  AuthenticatedUser,
  BookingStatus,
  BookingType,
  flattenValidationErrors,
  PaginatedResponse,
  Role,
  toPaginated,
} from '../common';
import { FlightBooking } from '../flights/schemas/flight-booking.schema';
import { Flight } from '../flights/schemas/flight.schema';
import { HotelBooking } from '../hotels/schemas/hotel-booking.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { User } from '../users/schemas/user.schema';
import { AdminBookingResponseDto } from './dto/admin-booking-response.dto';
import { AdminBookingsQueryDto } from './dto/admin-bookings-query.dto';

interface BookingRow {
  _id: Types.ObjectId;
  type: BookingType;
  userId: Types.ObjectId;
  providerId: Types.ObjectId;
  bookingReference?: string;
  totalCents: number;
  currency: string;
  status: BookingStatus;
  createdAt: Date;
}

interface FlightRow extends BookingRow {
  type: BookingType.FLIGHT;
  flightId: Types.ObjectId;
  segmentIds?: Types.ObjectId[];
}

interface HotelRow extends BookingRow {
  type: BookingType.HOTEL;
  checkIn: string;
  checkOut: string;
}

interface BookingPage {
  items: (FlightRow | HotelRow)[];
  count: { total: number }[];
}

@Injectable()
export class AdminBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
  ) {}

  async list(
    actor: AuthenticatedUser,
    input: AdminBookingsQueryDto,
  ): Promise<PaginatedResponse<AdminBookingResponseDto>> {
    if (!actor?.userId)
      throw new UnauthorizedException('Authentication required');
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Administrator role required');

    const query = plainToInstance(AdminBookingsQueryDto, input ?? {});
    const errors = validateSync(query, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const details = flattenValidationErrors(errors);
    if (details.length)
      throw new BadRequestException({ message: 'Validation failed', details });

    const { page, limit, type, status, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;
    if (!Number.isSafeInteger(skip) || !Number.isSafeInteger(page)) {
      throw this.invalidField('page', 'page is too large');
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw this.invalidField('dateTo', 'dateTo must be on or after dateFrom');
    }

    const match: {
      status?: BookingStatus;
      createdAt?: { $gte?: Date; $lt?: Date };
    } = {};
    if (status) match.status = status;
    if (dateFrom || dateTo) {
      match.createdAt = {};
      if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const nextDay = new Date(dateTo);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        match.createdAt.$lt = nextDay;
      }
    }

    const project = {
      _id: 1,
      userId: 1,
      bookingReference: 1,
      totalCents: 1,
      currency: 1,
      status: 1,
      createdAt: 1,
    };
    const flightPipeline = [
      { $match: match },
      {
        $project: {
          ...project,
          type: { $literal: BookingType.FLIGHT },
          providerId: '$airlineId',
          flightId: 1,
          segmentIds: '$segments.flightId',
        },
      },
    ];
    const hotelPipeline = [
      { $match: match },
      {
        $project: {
          ...project,
          type: { $literal: BookingType.HOTEL },
          providerId: '$hotelId',
          checkIn: 1,
          checkOut: 1,
        },
      },
    ];
    const onlyHotels = type === BookingType.HOTEL;
    const pipeline: PipelineStage[] = onlyHotels
      ? hotelPipeline
      : flightPipeline;
    if (!type) {
      pipeline.push({
        $unionWith: {
          coll: this.hotelBookings.collection.name,
          pipeline: hotelPipeline,
        },
      });
    }
    // Sort outside the facet so MongoDB can spill the sort to disk. Only one page reaches enrichment.
    pipeline.push(
      { $sort: { createdAt: -1, type: 1, _id: -1 } },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          count: [{ $count: 'total' }],
        },
      },
    );

    try {
      const source = onlyHotels ? this.hotelBookings : this.flightBookings;
      const [result] = await source
        .aggregate<BookingPage>(pipeline)
        .allowDiskUse(true)
        .exec();
      const items = await this.enrich(result?.items ?? []);
      return toPaginated(items, result?.count[0]?.total ?? 0, page, limit);
    } catch {
      // The global error filter logs exceptions. Never attach driver errors or their causes.
      throw new InternalServerErrorException('Bookings could not be retrieved');
    }
  }

  private async enrich(
    rows: BookingPage['items'],
  ): Promise<AdminBookingResponseDto[]> {
    if (!rows.length) return [];
    const flightRows = rows.filter((row) => row.type === BookingType.FLIGHT);
    const hotelRows = rows.filter((row) => row.type === BookingType.HOTEL);
    const dates = (row: FlightRow) => {
      const ids = row.segmentIds?.length ? row.segmentIds : [row.flightId];
      return { first: ids[0], last: ids[ids.length - 1] };
    };
    const flightIds = flightRows.flatMap((row) => {
      const { first, last } = dates(row);
      return [first, last];
    });
    const [users, airlines, hotels, flights] = await Promise.all([
      this.users
        .find({ _id: { $in: rows.map((row) => row.userId) } }, { name: 1 })
        .lean()
        .exec(),
      flightRows.length
        ? this.airlines
            .find(
              { _id: { $in: flightRows.map((row) => row.providerId) } },
              { name: 1 },
            )
            .lean()
            .exec()
        : [],
      hotelRows.length
        ? this.hotels
            .find(
              { _id: { $in: hotelRows.map((row) => row.providerId) } },
              { name: 1 },
            )
            .lean()
            .exec()
        : [],
      flightIds.length
        ? this.flights
            .find({ _id: { $in: flightIds } }, { departureAt: 1, arrivalAt: 1 })
            .lean()
            .exec()
        : [],
    ]);
    const names = (parties: { _id: Types.ObjectId; name: string }[]) =>
      new Map(parties.map((party) => [String(party._id), party.name]));
    const userNames = names(users);
    const providerNames = {
      [BookingType.FLIGHT]: names(airlines),
      [BookingType.HOTEL]: names(hotels),
    };
    const flightsById = new Map(
      flights.map((flight) => [String(flight._id), flight]),
    );

    return rows.map((row) => {
      const userId = String(row.userId);
      const providerId = String(row.providerId);
      let startDate: string | null;
      let endDate: string | null;
      if (row.type === BookingType.FLIGHT) {
        const { first, last } = dates(row);
        startDate =
          flightsById.get(String(first))?.departureAt?.toISOString() ?? null;
        endDate =
          flightsById.get(String(last))?.arrivalAt?.toISOString() ?? null;
      } else {
        startDate = row.checkIn ?? null;
        endDate = row.checkOut ?? null;
      }
      return {
        id: String(row._id),
        type: row.type,
        bookingReference: row.bookingReference ?? null,
        user: { id: userId, name: userNames.get(userId) ?? null },
        provider: {
          id: providerId,
          name: providerNames[row.type].get(providerId) ?? null,
        },
        startDate,
        endDate,
        totalCents: row.totalCents,
        currency: row.currency,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  private invalidField(field: string, message: string): BadRequestException {
    return new BadRequestException({
      message: 'Validation failed',
      details: [{ field, message }],
    });
  }
}
