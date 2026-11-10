import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  BookingStatus,
  HOLD_MINUTES,
  PLATFORM_CURRENCY,
} from '../common';
import { FlightInventoryService } from './flight-inventory.service';
import {
  FlightBookingResponseDto,
  toFlightBookingResponse,
} from './dto/flight-booking-response.dto';
import { HoldFlightBookingDto } from './dto/hold-flight-booking.dto';
import { FlightBooking, FlightBookingLean } from './schemas/flight-booking.schema';
import {
  bookingTotalCents,
  infantFareCents,
  seatsNeeded,
} from './utils/booking-price';

@Injectable()
export class FlightBookingsService {
  constructor(
    @InjectModel(FlightBooking.name) private readonly model: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: FlightInventoryService,
  ) {}

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
      throw new BadRequestException({
        message: 'Validation failed',
        details: [
          {
            field: 'infants',
            message: 'infants must not be more than adults (at most one infant per adult)',
          },
        ],
      });
    }

    const flight = await this.inventory.loadBookableFlight(dto.flightId, now);
    const seats = seatsNeeded(dto);
    const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

    // connection.transaction() commits on success, aborts when the callback throws, and retries on the
    // transient errors MongoDB raises when parallel requests collide.
    let booking: FlightBookingLean | undefined;
    await this.connection.transaction(async (session) => {
      const cabin = await this.inventory.holdSeats(
        flight._id,
        dto.cabinClass,
        seats,
        session,
      );
      if (!cabin) {
        if (!(await this.inventory.cabinExists(flight._id, dto.cabinClass, session))) {
          throw new NotFoundException('This flight has no such cabin');
        }
        throw new ConflictException('Not enough seats left in this cabin');
      }

      // The fare comes from the cabin document the hold just updated, so price and seats always agree.
      const fare = cabin.priceCents;
      const [created] = await this.model.create(
        [
          {
            userId: new Types.ObjectId(user.userId),
            airlineId: flight.airlineId,
            flightId: flight._id,
            cabinClass: dto.cabinClass,
            passengerCounts: {
              adults: dto.adults,
              children: dto.children,
              infants: dto.infants,
            },
            seats,
            farePerPassengerCents: fare,
            infantFareCents: infantFareCents(fare),
            totalCents: bookingTotalCents(fare, dto),
            currency: PLATFORM_CURRENCY,
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt,
          },
        ],
        { session },
      );
      booking = created.toObject<FlightBookingLean>();
    });

    return toFlightBookingResponse(booking as FlightBookingLean);
  }
}
