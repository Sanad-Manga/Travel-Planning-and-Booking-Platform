import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  BookingStatus,
  FlightStatus,
  PassengerType,
} from '../common';
import {
  SeatMapQueryDto,
  SeatMapResponseDto,
  SeatSelectionDto,
  SeatStatus,
  SelectSeatDto,
  SelectSeatResponseDto,
} from './dto/select-seat.dto';
import { Cabin, CabinLean } from './schemas/cabin.schema';
import {
  FlightBooking,
  FlightBookingLean,
  getFlightBookingSegments,
} from './schemas/flight-booking.schema';
import {
  FlightSeatClaim,
  FlightSeatClaimLean,
} from './schemas/flight-seat-claim.schema';
import { Flight, FlightLean } from './schemas/flight.schema';
import { normalizeSeat, seatExists, seatLabels } from './utils/seat-map';

/** A claim of a CONFIRMED booking that never got its selection written (a crash) is treated as free after this long. */
const ORPHAN_CLAIM_MS = 60_000;

/**
 * FLT-28: the owner of a confirmed booking chooses a seat for one passenger on one flight of the booking.
 *
 * - The seat must exist in the cabin that was booked (derived from the cabin's `totalSeats`, see utils/seat-map).
 * - "Free" is decided by inserting a claim row under a unique index on flight + cabin + seat, so two travelers asking
 *   for the same seat at the same moment cannot both win (the loser gets 409). Nothing is read first and written after.
 * - Changing seat claims the new seat first and releases the old one only after the booking points at the new one.
 * - A claim whose booking was cancelled, expired or completed is stale: the next traveler takes the seat over, so
 *   no cancellation path has to remember to release seats.
 */
@Injectable()
export class FlightSeatSelectionService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Cabin.name) private readonly cabins: Model<Cabin>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(FlightSeatClaim.name)
    private readonly claims: Model<FlightSeatClaim>,
  ) {}

  async selectSeat(
    user: AuthenticatedUser,
    id: string,
    dto: SelectSeatDto,
    now: Date = new Date(),
  ): Promise<SelectSeatResponseDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Flight booking not found');
    }
    const bookingId = new Types.ObjectId(id);
    // Only the owner can see the booking: someone else's booking and a missing one are the same 404.
    const booking = await this.bookings
      .findOne({ _id: bookingId, userId: new Types.ObjectId(user.userId) })
      .lean<FlightBookingLean>()
      .exec();
    if (!booking) throw new NotFoundException('Flight booking not found');
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        'Seats can be chosen only on a confirmed booking',
      );
    }

    const seat = normalizeSeat(dto.seat);
    if (!seat) throw this.invalid('seat', 'seat must look like 12A');

    const segments = getFlightBookingSegments(booking);
    const segment = dto.flightId
      ? segments.find((s) => s.flightId.toString() === dto.flightId)
      : segments[0];
    if (!segment) {
      throw this.invalid(
        'flightId',
        'flightId is not a flight of this booking',
      );
    }

    const passengerIndex = dto.passengerIndex ?? 0;
    const passenger = booking.passengers?.[passengerIndex];
    if (!booking.passengers?.length) {
      throw new ConflictException(
        'This booking has no passenger details, so a seat cannot be assigned',
      );
    }
    if (!passenger) {
      throw this.invalid(
        'passengerIndex',
        `passengerIndex must be between 0 and ${booking.passengers.length - 1}`,
      );
    }
    if (passenger.passengerType === PassengerType.INFANT) {
      throw this.invalid('passengerIndex', 'An infant does not take a seat');
    }

    const [flight, cabin] = await Promise.all([
      this.flights.findById(segment.flightId).lean<FlightLean>().exec(),
      this.cabins
        .findOne({ flightId: segment.flightId, cabinClass: segment.cabinClass })
        .lean<CabinLean>()
        .exec(),
    ]);
    if (!flight || !cabin) {
      throw new NotFoundException('The booked flight or cabin was not found');
    }
    if (flight.status !== FlightStatus.SCHEDULED || flight.departureAt <= now) {
      throw new ConflictException(
        'Seats can no longer be chosen on this flight',
      );
    }
    if (!seatExists(seat, cabin.totalSeats)) {
      throw this.invalid(
        'seat',
        `Seat ${seat} does not exist in the ${segment.cabinClass} cabin of this flight`,
      );
    }

    const previous = booking.seatSelections?.find(
      (s) =>
        s.flightId.equals(segment.flightId) &&
        s.passengerIndex === passengerIndex,
    );
    if (previous?.seat === seat) {
      return this.response(bookingId, booking.seatSelections ?? []);
    }

    const claim = await this.claim(
      segment.flightId,
      segment.cabinClass,
      seat,
      bookingId,
      passengerIndex,
    );

    // One update: drop this passenger's old selection on this flight and add the new one. Only while confirmed.
    const selection = {
      flightId: segment.flightId,
      passengerIndex,
      seat,
    };
    let updated: FlightBookingLean | null;
    try {
      updated = await this.bookings
        .findOneAndUpdate(
          { _id: bookingId, status: BookingStatus.CONFIRMED },
          [
            {
              $set: {
                seatSelections: {
                  $concatArrays: [
                    {
                      $filter: {
                        input: { $ifNull: ['$seatSelections', []] },
                        as: 's',
                        cond: {
                          $not: [
                            {
                              $and: [
                                { $eq: ['$$s.flightId', segment.flightId] },
                                { $eq: ['$$s.passengerIndex', passengerIndex] },
                              ],
                            },
                          ],
                        },
                      },
                    },
                    [selection],
                  ],
                },
              },
            },
          ],
          { new: true },
        )
        .lean<FlightBookingLean>()
        .exec();
    } catch (error) {
      await this.claims.deleteOne({ _id: claim._id }).exec();
      throw error;
    }
    if (!updated) {
      // Cancelled in the meantime: the seat must not stay blocked.
      await this.claims.deleteOne({ _id: claim._id }).exec();
      throw new ConflictException(
        'Seats can be chosen only on a confirmed booking',
      );
    }

    if (previous) {
      await this.claims
        .deleteOne({
          flightId: segment.flightId,
          cabinClass: segment.cabinClass,
          seat: previous.seat,
          bookingId,
          passengerIndex,
        })
        .exec();
    }
    return this.response(bookingId, updated.seatSelections ?? []);
  }

  /**
   * FLT-28: the seat chart of the booked cabin, for the owner of a confirmed booking: every seat with FREE, TAKEN
   * or YOURS. A claim counts only while its booking is still CONFIRMED (same rule as choosing a seat), so seats of
   * cancelled bookings show as free. Nothing about who holds a TAKEN seat is returned.
   */
  async getSeatMap(
    user: AuthenticatedUser,
    id: string,
    query: SeatMapQueryDto,
  ): Promise<SeatMapResponseDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Flight booking not found');
    }
    const bookingId = new Types.ObjectId(id);
    const booking = await this.bookings
      .findOne({ _id: bookingId, userId: new Types.ObjectId(user.userId) })
      .lean<FlightBookingLean>()
      .exec();
    if (!booking) throw new NotFoundException('Flight booking not found');
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        'The seat map is available only on a confirmed booking',
      );
    }
    const segments = getFlightBookingSegments(booking);
    const segment = query.flightId
      ? segments.find((s) => s.flightId.toString() === query.flightId)
      : segments[0];
    if (!segment) {
      throw this.invalid(
        'flightId',
        'flightId is not a flight of this booking',
      );
    }

    const cabin = await this.cabins
      .findOne({ flightId: segment.flightId, cabinClass: segment.cabinClass })
      .lean<CabinLean>()
      .exec();
    if (!cabin) throw new NotFoundException('The booked cabin was not found');

    const claims = await this.claims
      .find({ flightId: segment.flightId, cabinClass: segment.cabinClass })
      .select('seat bookingId')
      .lean<Pick<FlightSeatClaimLean, 'seat' | 'bookingId'>[]>()
      .exec();
    const holderIds = [...new Set(claims.map((c) => c.bookingId.toString()))];
    const live = new Set(
      (
        await this.bookings
          .find({
            _id: { $in: holderIds.map((h) => new Types.ObjectId(h)) },
            status: BookingStatus.CONFIRMED,
          })
          .select('_id')
          .lean<{ _id: Types.ObjectId }[]>()
          .exec()
      ).map((b) => b._id.toString()),
    );
    const status = new Map<string, SeatStatus>();
    for (const claim of claims) {
      const holder = claim.bookingId.toString();
      if (!live.has(holder)) continue;
      status.set(
        claim.seat,
        holder === bookingId.toString() ? SeatStatus.YOURS : SeatStatus.TAKEN,
      );
    }
    return {
      bookingId: bookingId.toString(),
      flightId: segment.flightId.toString(),
      cabinClass: segment.cabinClass,
      seats: seatLabels(cabin.totalSeats).map((seat) => ({
        seat,
        status: status.get(seat) ?? SeatStatus.FREE,
      })),
    };
  }

  /**
   * Takes the seat with one insert. A duplicate key means somebody holds it: 409 unless that claim is stale, in
   * which case it is removed and the insert is tried once more (a second duplicate means somebody else got there first).
   */
  private async claim(
    flightId: Types.ObjectId,
    cabinClass: FlightSeatClaim['cabinClass'],
    seat: string,
    bookingId: Types.ObjectId,
    passengerIndex: number,
  ): Promise<{ _id: Types.ObjectId }> {
    const insert = async () =>
      this.claims.create({
        flightId,
        cabinClass,
        seat,
        bookingId,
        passengerIndex,
      });
    try {
      return await insert();
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }

    const holder = await this.claims
      .findOne({ flightId, cabinClass, seat })
      .lean<FlightSeatClaimLean>()
      .exec();
    if (holder && !(await this.isStale(holder))) throw this.taken(seat);
    if (holder) await this.claims.deleteOne({ _id: holder._id }).exec();
    try {
      return await insert();
    } catch (error) {
      if (isDuplicateKey(error)) throw this.taken(seat);
      throw error;
    }
  }

  private async isStale(claim: FlightSeatClaimLean): Promise<boolean> {
    const holder = await this.bookings
      .findById(claim.bookingId)
      .select('status seatSelections')
      .lean<Pick<FlightBookingLean, 'status' | 'seatSelections'>>()
      .exec();
    if (!holder || holder.status !== BookingStatus.CONFIRMED) return true;
    const recorded = holder.seatSelections?.some(
      (s) =>
        s.flightId.equals(claim.flightId) &&
        s.passengerIndex === claim.passengerIndex &&
        s.seat === claim.seat,
    );
    // A confirmed holder that does not point at the seat is either mid-request or a crashed request: only the latter
    // is old enough to be taken over.
    return (
      !recorded && Date.now() - claim.createdAt.getTime() > ORPHAN_CLAIM_MS
    );
  }

  private response(
    bookingId: Types.ObjectId,
    selections: {
      flightId: Types.ObjectId;
      passengerIndex: number;
      seat: string;
    }[],
  ): SelectSeatResponseDto {
    const seatSelections: SeatSelectionDto[] = selections.map((s) => ({
      flightId: s.flightId.toString(),
      passengerIndex: s.passengerIndex,
      seat: s.seat,
    }));
    return { bookingId: bookingId.toString(), seatSelections };
  }

  private taken(seat: string): ConflictException {
    return new ConflictException(`Seat ${seat} is already taken`);
  }

  private invalid(field: string, message: string): BadRequestException {
    return new BadRequestException({
      message: 'Validation failed',
      details: [{ field, message }],
    });
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number })?.code === 11000;
}
