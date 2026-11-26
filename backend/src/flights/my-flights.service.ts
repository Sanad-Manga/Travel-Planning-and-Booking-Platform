import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  FlightStatus,
  PaginatedResponse,
  Role,
  toPaginated,
} from '../common';
import { FlightResponseDto, toFlightResponse } from './dto/flight-response.dto';
import { MyFlightsQueryDto } from './dto/my-flights-query.dto';
import { Flight, FlightLean } from './schemas/flight.schema';

/**
 * G1 / FLT-29: the flights of the moderator's own airline, in any status, so the moderator can reach
 * cancelled and departed flights and open the bookings of each one. Read only.
 */
@Injectable()
export class MyFlightsService {
  constructor(@InjectModel(Flight.name) private readonly model: Model<Flight>) {}

  async list(
    user: AuthenticatedUser,
    query: MyFlightsQueryDto | Partial<MyFlightsQueryDto>,
    now: Date = new Date(),
  ): Promise<PaginatedResponse<FlightResponseDto>> {
    if (user.role !== Role.AIRLINE_MODERATOR || !user.airlineId) {
      throw new ForbiddenException('Only an airline moderator can list flights');
    }
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const filter = this.filterFor(
      new Types.ObjectId(user.airlineId),
      query.status,
      now,
    );

    const [rows, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ departureAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<FlightLean[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return toPaginated(
      rows.map((row) => toFlightResponse(row, now)),
      total,
      page,
      limit,
    );
  }

  /** A stored SCHEDULED flight that has already left is reported as DEPARTED (FLT-30), so the filter agrees. */
  private filterFor(
    airlineId: Types.ObjectId,
    status: FlightStatus | undefined,
    now: Date,
  ): FilterQuery<Flight> {
    if (status === FlightStatus.SCHEDULED) {
      return {
        airlineId,
        status: FlightStatus.SCHEDULED,
        departureAt: { $gt: now },
      };
    }
    if (status === FlightStatus.DEPARTED) {
      return {
        airlineId,
        $or: [
          { status: FlightStatus.DEPARTED },
          { status: FlightStatus.SCHEDULED, departureAt: { $lte: now } },
        ],
      };
    }
    return status ? { airlineId, status } : { airlineId };
  }
}
