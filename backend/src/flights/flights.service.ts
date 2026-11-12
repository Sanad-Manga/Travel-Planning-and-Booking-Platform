import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AirlinesService } from '../airlines';
import { AuthenticatedUser, localToUtc, Role } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightResponseDto, toFlightResponse } from './dto/flight-response.dto';
import { Flight, FlightLean } from './schemas/flight.schema';

const MONGO_DUPLICATE_KEY = 11000;

interface FieldError {
  field: string;
  message: string;
}

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name) private readonly model: Model<Flight>,
    private readonly airlines: AirlinesService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * FLT-03: an airline moderator creates a flight for THEIR airline.
   * Local times are read in each airport's own time zone and stored in UTC. Every broken rule is reported
   * at once as a field-level 400; a repeated flight number on the same date is a 409.
   * `now` is a parameter only so tests can fix the clock.
   */
  async create(
    user: AuthenticatedUser,
    dto: CreateFlightDto,
    now: Date = new Date(),
  ): Promise<FlightResponseDto> {
    // The airline comes from the login, never from the body, so a moderator cannot create for another one.
    if (user.role !== Role.AIRLINE_MODERATOR || !user.airlineId) {
      throw new ForbiddenException(
        'Only an airline moderator can create flights',
      );
    }
    const airline = await this.airlines.findById(user.airlineId);
    if (!airline) throw new NotFoundException('Airline not found');
    if (!airline.isActive) {
      throw new ForbiddenException('This airline is deactivated');
    }

    const [departure, arrival] = await Promise.all([
      this.referenceData.findAirportById(dto.departureAirport),
      this.referenceData.findAirportById(dto.arrivalAirport),
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

    const departureAt = departure
      ? this.toUtc(
          dto.departureLocalTime,
          departure.time_zone,
          'departureLocalTime',
          errors,
        )
      : null;
    const arrivalAt = arrival
      ? this.toUtc(
          dto.arrivalLocalTime,
          arrival.time_zone,
          'arrivalLocalTime',
          errors,
        )
      : null;

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
    if (departureAt && departureAt.getTime() <= now.getTime()) {
      errors.push({
        field: 'departureLocalTime',
        message: 'departureLocalTime must be in the future',
      });
    }
    if (errors.length > 0 || !departure || !arrival) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: errors,
      });
    }

    try {
      const created = await this.model.create({
        airlineId: new Types.ObjectId(user.airlineId),
        flightNumber: dto.flightNumber,
        departureAirport: departure.iata_code,
        arrivalAirport: arrival.iata_code,
        departureAt,
        arrivalAt,
        departureTimeZone: departure.time_zone,
        arrivalTimeZone: arrival.time_zone,
        departureLocalDate: dto.departureLocalTime.slice(0, 10),
      });
      return toFlightResponse(created.toObject<FlightLean>());
    } catch (error) {
      if ((error as { code?: unknown })?.code === MONGO_DUPLICATE_KEY) {
        throw new ConflictException({
          message: 'Flight already exists',
          details: [
            {
              field: 'flightNumber',
              message:
                'this airline already has this flight number on that departure date',
            },
          ],
        });
      }
      throw error;
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
