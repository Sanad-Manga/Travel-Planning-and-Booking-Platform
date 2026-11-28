import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  FlightStatus,
  PaginatedResponse,
  PaginationDto,
  Role,
  toPaginated,
} from '../common';
import { CabinResponseDto, toCabinResponse } from './dto/cabin-response.dto';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { Cabin, CabinLean } from './schemas/cabin.schema';
import { Flight, FlightLean } from './schemas/flight.schema';
import { effectiveFlightStatus } from './utils/flight-status';

const MONGO_DUPLICATE_KEY = 11000;

/** FLT-04: an airline moderator defines and edits the cabin categories of their own flights. */
@Injectable()
export class FlightCabinsService {
  constructor(
    @InjectModel(Cabin.name) private readonly cabins: Model<Cabin>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
  ) {}

  /**
   * FLT-04 (read): the cabins of the moderator's own flight, dearest first, with the ids and seat totals the
   * edit screen needs (the public flight details show neither). Read only, so it works on a cancelled or
   * departed flight too.
   */
  async list(
    user: AuthenticatedUser,
    flightId: string,
    query: Partial<PaginationDto>,
  ): Promise<PaginatedResponse<CabinResponseDto>> {
    const flight = await this.ownedFlight(user, flightId);
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const filter = { flightId: flight._id };
    const [rows, total] = await Promise.all([
      this.cabins
        .find(filter)
        .sort({ priceCents: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<CabinLean[]>()
        .exec(),
      this.cabins.countDocuments(filter).exec(),
    ]);
    return toPaginated(rows.map(toCabinResponse), total, page, limit);
  }

  async create(
    user: AuthenticatedUser,
    flightId: string,
    dto: CreateCabinDto,
  ): Promise<CabinResponseDto> {
    const flight = await this.ownedScheduledFlight(user, flightId);
    try {
      const created = await this.cabins.create({
        flightId: flight._id,
        cabinClass: dto.cabinClass,
        totalSeats: dto.totalSeats,
        priceCents: dto.priceCents,
        freeBags: dto.freeBags,
        maxBagWeightKg: dto.maxBagWeightKg,
      });
      return toCabinResponse(created.toObject<CabinLean>());
    } catch (error) {
      if ((error as { code?: unknown })?.code === MONGO_DUPLICATE_KEY) {
        throw new ConflictException({
          message: 'Cabin already exists',
          details: [
            {
              field: 'cabinClass',
              message: 'this flight already has a cabin of this class',
            },
          ],
        });
      }
      throw error;
    }
  }

  /**
   * Edits seats, price or baggage of one cabin. The class cannot change. `bookedSeats` / `heldSeats` are
   * not editable here. Lowering `totalSeats` below booked + held is refused (409) inside the same atomic
   * update, so a booking that lands at the same moment cannot be oversold.
   */
  async update(
    user: AuthenticatedUser,
    flightId: string,
    cabinId: string,
    dto: UpdateCabinDto,
  ): Promise<CabinResponseDto> {
    const flight = await this.ownedScheduledFlight(user, flightId);

    const changes: Partial<
      Pick<Cabin, 'totalSeats' | 'priceCents' | 'freeBags' | 'maxBagWeightKg'>
    > = {};
    if (dto.totalSeats !== undefined) changes.totalSeats = dto.totalSeats;
    if (dto.priceCents !== undefined) changes.priceCents = dto.priceCents;
    if (dto.freeBags !== undefined) changes.freeBags = dto.freeBags;
    if (dto.maxBagWeightKg !== undefined)
      changes.maxBagWeightKg = dto.maxBagWeightKg;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        message: 'Nothing to update',
        details: [
          {
            field: 'body',
            message:
              'send at least one of totalSeats, priceCents, freeBags, maxBagWeightKg',
          },
        ],
      });
    }

    const filter: FilterQuery<Cabin> = { _id: cabinId, flightId: flight._id };
    if (changes.totalSeats !== undefined) {
      filter.$expr = {
        $gte: [changes.totalSeats, { $add: ['$bookedSeats', '$heldSeats'] }],
      };
    }
    const updated = await this.cabins
      .findOneAndUpdate(
        filter,
        { $set: changes },
        { new: true, runValidators: true },
      )
      .lean<CabinLean>()
      .exec();
    if (updated) return toCabinResponse(updated);

    // Not updated: either there is no such cabin on this flight, or the seat floor stopped it.
    const exists = await this.cabins.exists({
      _id: cabinId,
      flightId: flight._id,
    });
    if (!exists) throw new NotFoundException('Cabin not found');
    throw new ConflictException({
      message: 'Cannot remove seats that are already booked or held',
      details: [
        {
          field: 'totalSeats',
          message:
            'totalSeats cannot be lower than the seats already booked or held',
        },
      ],
    });
  }

  /** The flight must exist (404) and belong to the moderator's airline (403: a flight is public, nothing to hide). */
  private async ownedFlight(
    user: AuthenticatedUser,
    flightId: string,
  ): Promise<FlightLean> {
    if (user.role !== Role.AIRLINE_MODERATOR || !user.airlineId) {
      throw new ForbiddenException(
        'Only an airline moderator can manage cabins',
      );
    }
    const flight = Types.ObjectId.isValid(flightId)
      ? await this.flights.findById(flightId).lean<FlightLean>().exec()
      : null;
    if (!flight) throw new NotFoundException('Flight not found');
    if (flight.airlineId.toString() !== user.airlineId) {
      throw new ForbiddenException('You can only manage your own flights');
    }
    return flight;
  }

  /** As `ownedFlight`, and the flight must still be SCHEDULED (409: a cancelled or departed flight is not edited). */
  private async ownedScheduledFlight(
    user: AuthenticatedUser,
    flightId: string,
  ): Promise<FlightLean> {
    const flight = await this.ownedFlight(user, flightId);
    const status = effectiveFlightStatus(flight);
    if (status !== FlightStatus.SCHEDULED) {
      throw new ConflictException(
        `Cabins cannot be changed on a ${status} flight`,
      );
    }
    return flight;
  }
}
