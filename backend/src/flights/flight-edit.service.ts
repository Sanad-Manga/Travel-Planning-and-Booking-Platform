import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  BookingStatus,
  FlightStatus,
  localToUtc,
  NotificationType,
  Role,
  utcToLocal,
} from '../common';
import { NotificationsService } from '../notifications';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { FlightResponseDto, toFlightResponse } from './dto/flight-response.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { Flight, FlightLean } from './schemas/flight.schema';
import {
  FlightBooking,
  FlightBookingLean,
} from './schemas/flight-booking.schema';
import { effectiveFlightStatus } from './utils/flight-status';

const MONGO_DUPLICATE_KEY = 11000;

/** A booking in one of these states still ties a passenger (or a held seat) to the flight's route. */
const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
];

interface FieldError {
  field: string;
  message: string;
}

/**
 * FLT-05: an airline moderator edits the times and (while nobody has booked) the airports of THEIR
 * SCHEDULED flight. Cabin prices and seat counts are edited through FlightCabinsService (PATCH .../cabins/:cabinId).
 */
@Injectable()
export class FlightEditService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly referenceData: ReferenceDataService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Rules, in the order they are checked: moderator of the flight's airline (403), flight exists (404) and is still
   * SCHEDULED (409), something to change (400), every field valid (400, all errors at once), airports only change
   * while the flight has no active booking (409). A time change notifies every passenger with a CONFIRMED booking.
   * `now` is a parameter only so tests can fix the clock.
   */
  async update(
    user: AuthenticatedUser,
    flightId: string,
    dto: UpdateFlightDto,
    now: Date = new Date(),
  ): Promise<FlightResponseDto> {
    if (user.role !== Role.AIRLINE_MODERATOR || !user.airlineId) {
      throw new ForbiddenException(
        'Only an airline moderator can edit flights',
      );
    }
    const flight = Types.ObjectId.isValid(flightId)
      ? await this.flights.findById(flightId).lean<FlightLean>().exec()
      : null;
    if (!flight) throw new NotFoundException('Flight not found');
    if (flight.airlineId.toString() !== user.airlineId) {
      throw new ForbiddenException('You can only edit your own flights');
    }
    const status = effectiveFlightStatus(flight, now);
    if (status !== FlightStatus.SCHEDULED) {
      throw new ConflictException(`A ${status} flight cannot be edited`);
    }

    const fields = [
      'departureAirport',
      'arrivalAirport',
      'departureLocalTime',
      'arrivalLocalTime',
    ] as const;
    if (fields.every((field) => dto[field] === undefined)) {
      throw new BadRequestException({
        message: 'Nothing to update',
        details: [
          {
            field: 'body',
            message: `send at least one of ${fields.join(', ')}`,
          },
        ],
      });
    }

    const departureCode = dto.departureAirport ?? flight.departureAirport;
    const arrivalCode = dto.arrivalAirport ?? flight.arrivalAirport;
    const [departure, arrival] = await Promise.all([
      this.referenceData.findAirportById(departureCode),
      this.referenceData.findAirportById(arrivalCode),
    ]);

    const errors: FieldError[] = [];
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
    if (departure && arrival && departure.iata_code === arrival.iata_code) {
      errors.push({
        field: 'arrivalAirport',
        message: 'arrivalAirport must be different from departureAirport',
      });
    }

    // A time that is not sent keeps its stored instant; a sent one is read in its airport's own zone.
    const departureAt =
      dto.departureLocalTime !== undefined
        ? departure
          ? this.toUtc(
              dto.departureLocalTime,
              departure.time_zone,
              'departureLocalTime',
              errors,
            )
          : null
        : flight.departureAt;
    const arrivalAt =
      dto.arrivalLocalTime !== undefined
        ? arrival
          ? this.toUtc(
              dto.arrivalLocalTime,
              arrival.time_zone,
              'arrivalLocalTime',
              errors,
            )
          : null
        : flight.arrivalAt;

    if (
      departureAt &&
      arrivalAt &&
      arrivalAt.getTime() <= departureAt.getTime()
    ) {
      errors.push({
        field: 'arrivalLocalTime',
        message:
          'arrivalLocalTime must be after departureLocalTime (compared in UTC)',
      });
    }
    if (
      dto.departureLocalTime !== undefined &&
      departureAt &&
      departureAt.getTime() <= now.getTime()
    ) {
      errors.push({
        field: 'departureLocalTime',
        message: 'departureLocalTime must be in the future',
      });
    }
    if (
      errors.length > 0 ||
      !departure ||
      !arrival ||
      !departureAt ||
      !arrivalAt
    ) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: errors,
      });
    }

    const airportsChanged =
      departure.iata_code !== flight.departureAirport ||
      arrival.iata_code !== flight.arrivalAirport;
    if (airportsChanged && (await this.hasActiveBookings(flight._id))) {
      throw this.airportsLocked();
    }

    const timesChanged =
      departureAt.getTime() !== flight.departureAt.getTime() ||
      arrivalAt.getTime() !== flight.arrivalAt.getTime();

    let updated: FlightLean | null;
    try {
      updated = await this.flights
        .findOneAndUpdate(
          // Still SCHEDULED when the write happens: the status job may have run since we read it.
          { _id: flight._id, status: FlightStatus.SCHEDULED },
          {
            $set: {
              departureAirport: departure.iata_code,
              arrivalAirport: arrival.iata_code,
              departureAt,
              arrivalAt,
              departureTimeZone: departure.time_zone,
              arrivalTimeZone: arrival.time_zone,
              departureLocalDate:
                dto.departureLocalTime !== undefined
                  ? dto.departureLocalTime.slice(0, 10)
                  : utcToLocal(departureAt, departure.time_zone).slice(0, 10),
            },
          },
          { new: true },
        )
        .lean<FlightLean>()
        .exec();
    } catch (error) {
      if ((error as { code?: unknown })?.code === MONGO_DUPLICATE_KEY) {
        throw new ConflictException({
          message: 'Flight already exists',
          details: [
            {
              field: 'departureLocalTime',
              message:
                'this airline already has this flight number on that departure date',
            },
          ],
        });
      }
      throw error;
    }
    if (!updated) {
      throw new ConflictException('A flight that has left cannot be edited');
    }

    // A booking may have been held while we were writing. Seats are never taken from a route they were not
    // booked for, so undo the airport change instead of leaving a booked flight on a new route.
    if (airportsChanged && (await this.hasActiveBookings(flight._id))) {
      await this.flights.updateOne(
        { _id: flight._id },
        {
          $set: {
            departureAirport: flight.departureAirport,
            arrivalAirport: flight.arrivalAirport,
            departureTimeZone: flight.departureTimeZone,
            arrivalTimeZone: flight.arrivalTimeZone,
            departureLocalDate: flight.departureLocalDate,
            departureAt: flight.departureAt,
            arrivalAt: flight.arrivalAt,
          },
        },
      );
      throw this.airportsLocked();
    }

    if (timesChanged) await this.notifyPassengers(updated);
    return toFlightResponse(updated, now);
  }

  private hasActiveBookings(flightId: Types.ObjectId): Promise<boolean> {
    return this.bookings
      .exists({ flightId, status: { $in: ACTIVE_BOOKING_STATUSES } })
      .then(Boolean);
  }

  private airportsLocked(): ConflictException {
    return new ConflictException({
      message: 'The airports cannot change once the flight is booked',
      details: [
        {
          field: 'departureAirport',
          message:
            'airports are locked because this flight already has a booking',
        },
      ],
    });
  }

  /** One notification per passenger (not per booking). Never throws: NotificationsService logs its own failures. */
  private async notifyPassengers(flight: FlightLean): Promise<void> {
    const confirmed = await this.bookings
      .find({ flightId: flight._id, status: BookingStatus.CONFIRMED })
      .select('userId')
      .sort({ _id: 1 })
      .lean<Pick<FlightBookingLean, '_id' | 'userId'>[]>()
      .exec();
    const firstBookingOf = new Map<string, Types.ObjectId>();
    for (const booking of confirmed) {
      const userId = booking.userId.toString();
      if (!firstBookingOf.has(userId)) firstBookingOf.set(userId, booking._id);
    }
    const departure = utcToLocal(flight.departureAt, flight.departureTimeZone);
    const arrival = utcToLocal(flight.arrivalAt, flight.arrivalTimeZone);
    for (const [userId, bookingId] of firstBookingOf) {
      await this.notifications.notify({
        userId,
        type: NotificationType.FLIGHT_SCHEDULE_CHANGED,
        title: `Flight ${flight.flightNumber} schedule changed`,
        message: `Flight ${flight.flightNumber} now departs ${departure} (local time at ${flight.departureAirport}) and arrives ${arrival} (local time at ${flight.arrivalAirport}).`,
        link: `/flight-bookings/${bookingId.toString()}`,
      });
    }
  }

  private toUtc(
    local: string,
    timeZone: string,
    field: string,
    errors: FieldError[],
  ): Date | null {
    const utc = localToUtc(local, timeZone);
    if (!utc) {
      errors.push({
        field,
        message: `${field} is not a valid time in ${timeZone} (check the date, and daylight-saving gaps)`,
      });
    }
    return utc;
  }
}
