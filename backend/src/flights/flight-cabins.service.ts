import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuthenticatedUser, FlightStatus, Role } from '../common';
import { CabinResponseDto, toCabinResponse } from './dto/cabin-response.dto';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { Cabin, CabinLean } from './schemas/cabin.schema';
import { Flight, FlightLean } from './schemas/flight.schema';

const MONGO_DUPLICATE_KEY = 11000;

/** FLT-04: an airline moderator defines and edits the cabin categories of their own flights. */
@Injectable()
export class FlightCabinsService {
  constructor(
    @InjectModel(Cabin.name) private readonly cabins: Model<Cabin>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
  ) {}

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

  /**
   * The flight must exist (404), belong to the moderator's airline (403: a flight is public, nothing to hide)
   * and still be SCHEDULED (409: a cancelled or departed flight is not edited).
   */
  private async ownedScheduledFlight(
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
    if (flight.status !== FlightStatus.SCHEDULED) {
      throw new ConflictException(
        `Cabins cannot be changed on a ${flight.status} flight`,
      );
    }
    return flight;
  }
}
