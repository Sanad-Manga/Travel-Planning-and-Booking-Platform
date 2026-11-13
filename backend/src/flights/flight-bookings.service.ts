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
  HOLD_MINUTES,
  isCalendarDate,
  PassengerType,
  PLATFORM_CURRENCY,
} from '../common';
import { AirlinesService } from '../airlines';
import { FlightInventoryService } from './flight-inventory.service';
import {
  FlightBookingResponseDto,
  toFlightBookingResponse,
} from './dto/flight-booking-response.dto';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import {
  BookingPassenger,
  FlightBooking,
  FlightBookingLean,
} from './schemas/flight-booking.schema';
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

@Injectable()
export class FlightBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly model: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: FlightInventoryService,
    private readonly airlines: AirlinesService,
  ) {}

  /** FLT-19: derive passenger types from date of birth and create the pending booking with baggage details. */
  async create(
    user: AuthenticatedUser,
    dto: CreateFlightBookingDto,
    now: Date = new Date(),
  ): Promise<FlightBookingResponseDto> {
    const flight = await this.inventory.loadBookableFlight(dto.flightId, now);
    const passengerTypes = dto.passengers.map((passenger, index) =>
      passengerTypeFor(passenger.dateOfBirth, flight.departureLocalDate, index),
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
    const baggagePolicy = hasExtraBags
      ? await this.airlines.getBaggagePolicy(flight.airlineId.toString())
      : null;
    if (hasExtraBags && !baggagePolicy) {
      throw inputError(
        'passengers',
        'extra baggage is not available for this airline',
      );
    }

    const passengers: BookingPassenger[] = dto.passengers.map(
      (passenger, index) => {
        const extraBags = passenger.extraBags ?? [];
        if (baggagePolicy && extraBags.length > baggagePolicy.maxExtraBags) {
          throw inputError(
            `passengers.${index}.extraBags`,
            `no more than ${baggagePolicy.maxExtraBags} extra bags may be added per passenger`,
          );
        }
        return {
          fullName: passenger.fullName,
          dateOfBirth: passenger.dateOfBirth,
          passportOrIdNumber: passenger.passportOrIdNumber,
          passengerType: passengerTypes[index],
          extraBags,
          baggageFeeCents:
            extraBags.length * (baggagePolicy?.extraBagPriceCents ?? 0),
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

    return this.createPendingBooking(
      user,
      flight,
      dto.cabinClass,
      passengerCounts,
      passengers,
      baggageFeeCents,
      now,
    );
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
      flight,
      dto.cabinClass,
      counts,
      undefined,
      0,
      now,
    );
  }

  private async createPendingBooking(
    user: AuthenticatedUser,
    flight: Awaited<ReturnType<FlightInventoryService['loadBookableFlight']>>,
    cabinClass: HoldFlightBookingDto['cabinClass'],
    passengerCounts: PassengerCountsInput,
    passengers: BookingPassenger[] | undefined,
    baggageFeeCents: number,
    now: Date,
  ): Promise<FlightBookingResponseDto> {
    const seats = seatsNeeded(passengerCounts);
    const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

    // connection.transaction() commits on success, aborts when the callback throws, and retries on the
    // transient errors MongoDB raises when parallel requests collide.
    let booking: FlightBookingLean | undefined;
    await this.connection.transaction(async (session) => {
      const cabin = await this.inventory.holdSeats(
        flight._id,
        cabinClass,
        seats,
        session,
      );
      if (!cabin) {
        if (
          !(await this.inventory.cabinExists(flight._id, cabinClass, session))
        ) {
          throw new NotFoundException('This flight has no such cabin');
        }
        throw new ConflictException('Not enough seats left in this cabin');
      }

      passengers?.forEach((passenger, passengerIndex) => {
        passenger.extraBags.forEach((bag, bagIndex) => {
          if (bag.weightKg > cabin.maxBagWeightKg) {
            throw inputError(
              `passengers.${passengerIndex}.extraBags.${bagIndex}.weightKg`,
              `weightKg must be at most ${cabin.maxBagWeightKg} kg for this cabin`,
            );
          }
        });
      });

      // The fare comes from the cabin document the hold just updated, so price and seats always agree.
      const fare = cabin.priceCents;
      const [created] = await this.model.create(
        [
          {
            userId: new Types.ObjectId(user.userId),
            airlineId: flight.airlineId,
            flightId: flight._id,
            cabinClass,
            passengerCounts,
            ...(passengers ? { passengers } : {}),
            seats,
            farePerPassengerCents: fare,
            infantFareCents: infantFareCents(fare),
            baggageFeeCents,
            totalCents: bookingTotalCents(
              fare,
              passengerCounts,
              baggageFeeCents,
            ),
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
