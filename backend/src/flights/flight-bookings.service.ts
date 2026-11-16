import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  BookingStatus,
  BookingType,
  CabinClass,
  HOLD_MINUTES,
  isCalendarDate,
  PassengerType,
  PLATFORM_CURRENCY,
} from '../common';
import { AirlinesService } from '../airlines';
import { BookingLifecycle } from '../payments';
import { FlightInventoryService } from './flight-inventory.service';
import {
  FlightBookingResponseDto,
  toBookingPassengerResponse,
  toFlightBookingSegmentResponse,
  toFlightBookingResponse,
} from './dto/flight-booking-response.dto';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { FlightBookingSummaryResponseDto } from './dto/flight-booking-summary-response.dto';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBookingProvider } from './flight-booking.provider';
import {
  BookingPassenger,
  FlightBooking,
  FlightBookingLean,
  FlightBookingSegment,
  getFlightBookingSegments,
} from './schemas/flight-booking.schema';
import { Flight, FlightLean } from './schemas/flight.schema';
import { toFlightResponse } from './dto/flight-response.dto';
import {
  bookingTotalCents,
  infantFareCents,
  PassengerCountsInput,
  seatsNeeded,
} from './utils/booking-price';

function inputError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    message: 'Validation failed',
    details: [{ field, message }],
  });
}

function passengerTypeFor(
  dateOfBirth: string,
  departureLocalDate: string,
  passengerIndex: number,
): PassengerType {
  const field = `passengers.${passengerIndex}.dateOfBirth`;
  if (!isCalendarDate(dateOfBirth)) {
    throw inputError(field, 'dateOfBirth must be a valid calendar date');
  }
  if (!isCalendarDate(departureLocalDate)) {
    throw new InternalServerErrorException(
      'The flight has an invalid local departure date',
    );
  }
  if (dateOfBirth > departureLocalDate) {
    throw inputError(field, 'dateOfBirth must be on or before departure');
  }

  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
  const [departureYear, departureMonth, departureDay] = departureLocalDate
    .split('-')
    .map(Number);
  const age =
    departureYear -
    birthYear -
    (departureMonth < birthMonth ||
    (departureMonth === birthMonth && departureDay < birthDay)
      ? 1
      : 0);

  if (age < 2) return PassengerType.INFANT;
  if (age < 12) return PassengerType.CHILD;
  return PassengerType.ADULT;
}

interface RequestedSegment {
  flightId: string;
  cabinClass: CabinClass;
}

interface PreparedSegment {
  flight: FlightLean;
  cabinClass: CabinClass;
  baggageFeeCents: number;
}

@Injectable()
export class FlightBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly model: Model<FlightBooking>,
    @InjectModel(Flight.name)
    private readonly flights: Model<Flight>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: FlightInventoryService,
    private readonly airlines: AirlinesService,
    private readonly bookingProvider: FlightBookingProvider,
    private readonly bookingLifecycle: BookingLifecycle,
  ) {}

  /** FLT-19: derive passenger types from date of birth and create the pending booking with baggage details. */
  async create(
    user: AuthenticatedUser,
    dto: CreateFlightBookingDto,
    now: Date = new Date(),
  ): Promise<FlightBookingResponseDto> {
    const requestedSegments = this.requestedSegments(dto);
    const flights = await Promise.all(
      requestedSegments.map((segment) =>
        this.inventory.loadBookableFlight(segment.flightId, now),
      ),
    );
    if (flights.length === 2) {
      const [outbound, returning] = flights;
      if (
        outbound.departureAirport !== returning.arrivalAirport ||
        outbound.arrivalAirport !== returning.departureAirport
      ) {
        throw inputError(
          'segments.1.flightId',
          'return flight must reverse the outbound route',
        );
      }
      if (returning.departureAt.getTime() <= outbound.arrivalAt.getTime()) {
        throw inputError(
          'segments.1.flightId',
          'return flight must depart after the outbound flight arrives',
        );
      }
    }

    const outbound = flights[0];
    const passengerTypes = dto.passengers.map((passenger, index) =>
      passengerTypeFor(
        passenger.dateOfBirth,
        outbound.departureLocalDate,
        index,
      ),
    );
    const passengerCounts: PassengerCountsInput = {
      adults: passengerTypes.filter((type) => type === PassengerType.ADULT)
        .length,
      children: passengerTypes.filter((type) => type === PassengerType.CHILD)
        .length,
      infants: passengerTypes.filter((type) => type === PassengerType.INFANT)
        .length,
    };
    if (passengerCounts.adults === 0) {
      throw inputError(
        'passengers',
        'at least one passenger aged 12 or older is required',
      );
    }
    if (passengerCounts.infants > passengerCounts.adults) {
      throw inputError(
        'passengers',
        'infants must not be more than adults (at most one infant per adult)',
      );
    }

    const hasExtraBags = dto.passengers.some(
      (passenger) => (passenger.extraBags?.length ?? 0) > 0,
    );
    const baggagePolicies = hasExtraBags
      ? await Promise.all(
          flights.map((flight) =>
            this.airlines.getBaggagePolicy(flight.airlineId.toString()),
          ),
        )
      : flights.map(() => null);
    if (hasExtraBags && baggagePolicies.some((policy) => policy === null)) {
      throw inputError(
        'passengers',
        'extra baggage must be available for every flight segment',
      );
    }

    const passengers: BookingPassenger[] = dto.passengers.map(
      (passenger, index) => {
        const extraBags = passenger.extraBags ?? [];
        let baggageFeeCents = 0;
        baggagePolicies.forEach((policy) => {
          if (!policy) return;
          if (extraBags.length > policy.maxExtraBags) {
            throw inputError(
              `passengers.${index}.extraBags`,
              `no more than ${policy.maxExtraBags} extra bags may be added per passenger on each flight segment`,
            );
          }
          baggageFeeCents +=
            extraBags.length * policy.extraBagPriceCents;
        });
        if (!Number.isSafeInteger(baggageFeeCents)) {
          throw inputError(
            `passengers.${index}.extraBags`,
            'the baggage fee exceeds the supported amount',
          );
        }
        return {
          fullName: passenger.fullName,
          dateOfBirth: passenger.dateOfBirth,
          passportOrIdNumber: passenger.passportOrIdNumber,
          passengerType: passengerTypes[index],
          extraBags,
          baggageFeeCents,
        };
      },
    );
    const baggageFeeCents = passengers.reduce(
      (total, passenger) => total + passenger.baggageFeeCents,
      0,
    );
    if (!Number.isSafeInteger(baggageFeeCents)) {
      throw inputError(
        'passengers',
        'the baggage fee exceeds the supported amount',
      );
    }

    const segments: PreparedSegment[] = flights.map((flight, index) => ({
      flight,
      cabinClass: requestedSegments[index].cabinClass,
      baggageFeeCents: passengers.reduce(
        (total, passenger) =>
          total +
          passenger.extraBags.length *
            (baggagePolicies[index]?.extraBagPriceCents ?? 0),
        0,
      ),
    }));
    return this.createPendingBooking(
      user,
      segments,
      passengerCounts,
      passengers,
      now,
    );
  }

  private requestedSegments(dto: CreateFlightBookingDto): RequestedSegment[] {
    if (dto.segments !== undefined) {
      if (dto.flightId !== undefined || dto.cabinClass !== undefined) {
        throw inputError(
          'segments',
          'use either segments or the one-way flightId and cabinClass fields',
        );
      }
      if (dto.segments.length !== 2) {
        throw inputError(
          'segments',
          'a round-trip booking must contain outbound and return legs',
        );
      }
      return dto.segments;
    }

    if (dto.flightId === undefined || dto.cabinClass === undefined) {
      throw inputError(
        'flightId',
        'provide flightId and cabinClass for a one-way booking, or two segments for a round trip',
      );
    }
    return [{ flightId: dto.flightId, cabinClass: dto.cabinClass }];
  }

  /** FLT-21: show the pending summary only to its owner, resolving an overdue hold before returning it. */
  async getSummary(
    user: AuthenticatedUser,
    id: string,
    now: Date = new Date(),
  ): Promise<FlightBookingSummaryResponseDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Flight booking not found');
    }
    const userId = new Types.ObjectId(user.userId);
    const ownerFilter = { _id: new Types.ObjectId(id), userId };
    const owned = await this.model
      .findOne(ownerFilter)
      .lean<FlightBookingLean>()
      .exec();
    if (!owned) throw new NotFoundException('Flight booking not found');

    await this.bookingLifecycle.expireIfDue(BookingType.FLIGHT, id, now);

    const booking = await this.model
      .findOne(ownerFilter)
      .lean<FlightBookingLean>()
      .exec();
    if (!booking) throw new NotFoundException('Flight booking not found');
    const payable = await this.bookingProvider.getPayable(id, user.userId);
    if (!payable) throw new NotFoundException('Flight booking not found');
    if (
      booking.status !== BookingStatus.PENDING_PAYMENT ||
      payable.status !== BookingStatus.PENDING_PAYMENT
    ) {
      throw new ConflictException(
        'A summary is available only while the booking is pending payment',
      );
    }

    const segments = getFlightBookingSegments(booking);
    const segmentFlights = await Promise.all(
      segments.map((segment) =>
        this.flights.findById(segment.flightId).lean<FlightLean>().exec(),
      ),
    );
    const summarySegments = segments.map((segment, index) => {
      const flight = segmentFlights[index];
      if (!flight) {
        throw new NotFoundException('A booked flight segment was not found');
      }
      return {
        ...toFlightBookingSegmentResponse(segment),
        flight: toFlightResponse(flight),
      };
    });
    const outboundSummary = summarySegments[0];
    if (!outboundSummary) {
      throw new InternalServerErrorException(
        'The flight booking has no outbound segment',
      );
    }

    return {
      id: booking._id.toString(),
      flight: outboundSummary.flight,
      segments: summarySegments,
      cabinClass: booking.cabinClass,
      passengerCounts: {
        adults: booking.passengerCounts.adults,
        children: booking.passengerCounts.children,
        infants: booking.passengerCounts.infants,
      },
      passengers: (booking.passengers ?? []).map(toBookingPassengerResponse),
      baggageFeeCents: booking.baggageFeeCents ?? 0,
      totalCents: payable.amountCents,
      currency: payable.currency,
      status: payable.status,
      holdExpiresAt: payable.holdExpiresAt?.toISOString() ?? null,
    };
  }

  /**
   * FLT-22: the traveler proceeds to payment. In ONE transaction the requested seats are reserved with a single
   * conditional update (only if enough remain) and a PENDING_PAYMENT booking is created, held for HOLD_MINUTES.
   * If the hold fails nothing is written; if the booking insert fails the seats are not held either.
   * Infants take no seat. The traveler comes from the login and the price from the cabin: neither is in the body.
   * `now` is a parameter only so tests can fix the clock.
   */
  async hold(
    user: AuthenticatedUser,
    dto: HoldFlightBookingDto,
    now: Date = new Date(),
  ): Promise<FlightBookingResponseDto> {
    if (dto.infants > dto.adults) {
      throw inputError(
        'infants',
        'infants must not be more than adults (at most one infant per adult)',
      );
    }

    const flight = await this.inventory.loadBookableFlight(dto.flightId, now);
    const counts: PassengerCountsInput = {
      adults: dto.adults,
      children: dto.children,
      infants: dto.infants,
    };
    return this.createPendingBooking(
      user,
      [{ flight, cabinClass: dto.cabinClass, baggageFeeCents: 0 }],
      counts,
      undefined,
      now,
    );
  }

  private async createPendingBooking(
    user: AuthenticatedUser,
    requestedSegments: PreparedSegment[],
    passengerCounts: PassengerCountsInput,
    passengers: BookingPassenger[] | undefined,
    now: Date,
  ): Promise<FlightBookingResponseDto> {
    const seats = seatsNeeded(passengerCounts);
    const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

    // Both legs and their seat counters commit together; any failed hold aborts the transaction.
    let booking: FlightBookingLean | undefined;
    await this.connection.transaction(async (session) => {
      const segments: FlightBookingSegment[] = [];
      let totalCents = 0;
      for (const [index, requested] of requestedSegments.entries()) {
        const cabin = await this.inventory.holdSeats(
          requested.flight._id,
          requested.cabinClass,
          seats,
          session,
        );
        if (!cabin) {
          if (
            !(await this.inventory.cabinExists(
              requested.flight._id,
              requested.cabinClass,
              session,
            ))
          ) {
            throw new NotFoundException(
              `Flight segment ${index + 1} has no such cabin`,
            );
          }
          throw new ConflictException(
            `Not enough seats left in flight segment ${index + 1}`,
          );
        }

        passengers?.forEach((passenger, passengerIndex) => {
          passenger.extraBags.forEach((bag, bagIndex) => {
            if (bag.weightKg > cabin.maxBagWeightKg) {
              throw inputError(
                `passengers.${passengerIndex}.extraBags.${bagIndex}.weightKg`,
                `weightKg must be at most ${cabin.maxBagWeightKg} kg for flight segment ${index + 1}`,
              );
            }
          });
        });

        const fare = cabin.priceCents;
        const infantFare = infantFareCents(fare);
        segments.push({
          flightId: requested.flight._id,
          airlineId: requested.flight.airlineId,
          cabinClass: requested.cabinClass,
          seats,
          farePerPassengerCents: fare,
          infantFareCents: infantFare,
          baggageFeeCents: requested.baggageFeeCents,
        });
        totalCents += bookingTotalCents(
          fare,
          passengerCounts,
          requested.baggageFeeCents,
        );
      }

      const outbound = segments[0];
      if (!outbound || !Number.isSafeInteger(totalCents)) {
        throw new InternalServerErrorException(
          'The booking has invalid segment pricing',
        );
      }
      const baggageFeeCents = segments.reduce(
        (total, segment) => total + segment.baggageFeeCents,
        0,
      );
      if (!Number.isSafeInteger(baggageFeeCents)) {
        throw inputError(
          'passengers',
          'the baggage fee exceeds the supported amount',
        );
      }

      const [created] = await this.model.create(
        [
          {
            userId: new Types.ObjectId(user.userId),
            airlineId: outbound.airlineId,
            flightId: outbound.flightId,
            segments,
            cabinClass: outbound.cabinClass,
            passengerCounts,
            ...(passengers ? { passengers } : {}),
            seats,
            farePerPassengerCents: outbound.farePerPassengerCents,
            infantFareCents: outbound.infantFareCents,
            baggageFeeCents,
            totalCents,
            currency: PLATFORM_CURRENCY,
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt,
          },
        ],
        { session },
      );
      booking = created.toObject<FlightBookingLean>();
    });

    if (!booking) {
      throw new InternalServerErrorException(
        'The booking transaction completed without creating a booking',
      );
    }
    return toFlightBookingResponse(booking);
  }
}
