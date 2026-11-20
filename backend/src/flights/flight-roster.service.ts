import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { stringify } from 'csv-stringify/sync';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  PaginatedResponse,
  toPaginated,
  BookingStatus,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  Role,
} from '../common';
import {
  FlightRosterBookingDto,
  FlightRosterQueryDto,
} from './dto/flight-roster.dto';
import { Cabin } from './schemas/cabin.schema';
import {
  FlightBooking,
  FlightBookingLean,
  getFlightBookingSegments,
} from './schemas/flight-booking.schema';
import { Flight, FlightLean } from './schemas/flight.schema';

/** Bookings that reached payment: the passengers an airline actually serves. Unpaid and expired holds are not listed. */
const LISTED_STATUSES = [
  BookingStatus.CONFIRMED,
  BookingStatus.CANCELLED,
  BookingStatus.COMPLETED,
];

/** Passengers that are flying: cancelled bookings drop off the passenger list. */
const MANIFEST_STATUSES = [BookingStatus.CONFIRMED, BookingStatus.COMPLETED];

export interface PassengerCsvFile {
  content: string;
  filename: string;
}

const CSV_COLUMNS = [
  'bookingReference',
  'bookingStatus',
  'passengerName',
  'passengerType',
  'cabinClass',
  'seats',
];

/**
 * FLT-29: an airline moderator's read-only view of the bookings on THEIR OWN flight, and the passenger
 * list as CSV. Nothing here writes. A round-trip booking is listed under both of its flights, showing the
 * cabin and seats of the leg on the flight being viewed.
 */
@Injectable()
export class FlightRosterService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Cabin.name) private readonly cabins: Model<Cabin>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
  ) {}

  /** 403 for anyone but a moderator of the flight's airline, 404 for an unknown flight. */
  private async ownedFlight(
    user: AuthenticatedUser,
    flightId: string,
  ): Promise<FlightLean> {
    if (user.role !== Role.AIRLINE_MODERATOR || !user.airlineId) {
      throw new ForbiddenException(
        'Only an airline moderator can view flight bookings',
      );
    }
    const flight = Types.ObjectId.isValid(flightId)
      ? await this.flights.findById(flightId).lean<FlightLean>().exec()
      : null;
    if (!flight) throw new NotFoundException('Flight not found');
    if (flight.airlineId.toString() !== user.airlineId) {
      throw new ForbiddenException(
        'You can only view bookings of your own flights',
      );
    }
    return flight;
  }

  private filterFor(
    flight: FlightLean,
    statuses: BookingStatus[],
  ): FilterQuery<FlightBooking> {
    return {
      $or: [{ flightId: flight._id }, { 'segments.flightId': flight._id }],
      status: { $in: statuses },
    };
  }

  private toRow(
    booking: FlightBookingLean,
    flightId: Types.ObjectId,
    remaining: Map<string, number> = new Map(),
  ): FlightRosterBookingDto {
    const segment =
      getFlightBookingSegments(booking).find((s) =>
        s.flightId.equals(flightId),
      ) ?? getFlightBookingSegments(booking)[0];
    return {
      id: booking._id.toString(),
      ...(booking.bookingReference
        ? { bookingReference: booking.bookingReference }
        : {}),
      status: booking.status,
      cabinClass: segment.cabinClass,
      seats: segment.seats,
      cabinSeatsRemaining: remaining.get(segment.cabinClass) ?? 0,
      passengers: (booking.passengers ?? []).map((p) => ({
        fullName: p.fullName,
        passengerType: p.passengerType,
      })),
    };
  }

  async list(
    user: AuthenticatedUser,
    flightId: string,
    query: FlightRosterQueryDto,
  ): Promise<PaginatedResponse<FlightRosterBookingDto>> {
    const flight = await this.ownedFlight(user, flightId);
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const filter = this.filterFor(
      flight,
      query.status
        ? [query.status as unknown as BookingStatus]
        : LISTED_STATUSES,
    );

    const [rows, total, cabins] = await Promise.all([
      this.bookings
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<FlightBookingLean[]>()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
      this.cabins
        .find({ flightId: flight._id })
        .sort({ priceCents: -1 })
        .lean()
        .exec(),
    ]);

    const remaining = new Map(
      cabins.map((cabin) => [
        cabin.cabinClass as string,
        Math.max(0, cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats),
      ]),
    );
    return toPaginated(
      rows.map((row) => this.toRow(row, flight._id, remaining)),
      total,
      page,
      limit,
    );
  }

  /**
   * The passenger list of the flying (CONFIRMED and COMPLETED) bookings, one row per passenger. Commas,
   * quotes and line breaks are quoted, and a value that a spreadsheet would run as a formula is neutralised.
   * Passport/ID numbers and dates of birth are not exported. A legacy booking without passenger details
   * gets one row with an empty name so the file still accounts for its seats.
   */
  async exportPassengers(
    user: AuthenticatedUser,
    flightId: string,
  ): Promise<PassengerCsvFile> {
    const flight = await this.ownedFlight(user, flightId);
    const rows: Array<Array<string | number>> = [];
    const cursor = this.bookings
      .find(this.filterFor(flight, MANIFEST_STATUSES))
      .sort({ createdAt: 1, _id: 1 })
      .lean<FlightBookingLean[]>()
      .cursor();
    for await (const booking of cursor) {
      const listed = this.toRow(booking, flight._id);
      const base = [listed.bookingReference ?? '', listed.status];
      const tail = [listed.cabinClass, listed.seats];
      if (listed.passengers.length === 0) {
        rows.push([...base, '', '', ...tail]);
      }
      for (const passenger of listed.passengers) {
        rows.push([
          ...base,
          passenger.fullName,
          passenger.passengerType,
          ...tail,
        ]);
      }
    }
    return {
      content: stringify(rows, {
        header: true,
        columns: CSV_COLUMNS,
        escape_formulas: true,
        record_delimiter: '\r\n',
      }),
      filename: `flight-${flight.flightNumber}-passengers.csv`.replace(
        /[^A-Za-z0-9._-]/g,
        '_',
      ),
    };
  }
}
