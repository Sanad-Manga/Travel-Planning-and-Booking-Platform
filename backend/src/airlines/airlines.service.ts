import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, PLATFORM_CURRENCY, Role } from '../common';
import type { CancellationTier } from '../payments';
import {
  BaggagePolicyResponseDto,
  EXTRA_BAG_WEIGHT_RULE,
  SetBaggagePolicyDto,
} from './dto/baggage-policy.dto';
import {
  CancellationPolicyResponseDto,
  SetCancellationPolicyDto,
} from './dto/cancellation-policy.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import {
  AirlineResponseDto,
  toAirlineResponse,
} from './dto/airline-response.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { Airline, AirlineLean, BaggagePolicy } from './schemas/airline.schema';

const MONGO_DUPLICATE_KEY = 11000;

function sortTiers(tiers: ReadonlyArray<CancellationTier>): CancellationTier[] {
  return tiers
    .map((t) => ({
      daysBeforeThreshold: t.daysBeforeThreshold,
      refundPercent: t.refundPercent,
    }))
    .sort((a, b) => b.daysBeforeThreshold - a.daysBeforeThreshold);
}

function toBaggagePolicyResponse(
  policy: BaggagePolicy,
  airlineId: Types.ObjectId,
): BaggagePolicyResponseDto {
  return {
    airlineId: airlineId.toString(),
    extraBagPriceCents: policy.extraBagPriceCents,
    currency: PLATFORM_CURRENCY,
    maxExtraBags: policy.maxExtraBags,
    extraBagWeightRule: EXTRA_BAG_WEIGHT_RULE,
  };
}

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name) private readonly model: Model<Airline>,
  ) {}

  /** FLT-01: an admin creates an airline profile. (Who may call this is decided by @Roles on the route.) */
  async create(dto: CreateAirlineDto): Promise<AirlineResponseDto> {
    try {
      const created = await this.model.create({
        name: dto.name,
        code: dto.code,
        ...(dto.logoUrl ? { logoUrl: dto.logoUrl } : {}),
      });
      return toAirlineResponse(created.toObject<AirlineLean>());
    } catch (error) {
      throw this.translateDuplicateCode(error);
    }
  }

  async getById(id: string): Promise<AirlineResponseDto> {
    const airline = await this.findById(id);
    if (!airline) throw new NotFoundException('Airline not found');
    return toAirlineResponse(airline);
  }

  /**
   * FLT-01: an airline moderator edits their OWN airline (name, code, logo).
   * Ownership is checked here, before touching the database: the principal's `airlineId` must equal the
   * airline being edited. That is a 403 (not a 404) because the airline profile is not private.
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAirlineDto,
  ): Promise<AirlineResponseDto> {
    if (user.role !== Role.AIRLINE_MODERATOR || user.airlineId !== id) {
      throw new ForbiddenException('You can only edit your own airline');
    }

    const changes: Partial<Pick<Airline, 'name' | 'code' | 'logoUrl'>> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.code !== undefined) changes.code = dto.code;
    if (dto.logoUrl !== undefined) changes.logoUrl = dto.logoUrl;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        message: 'Nothing to update',
        details: [
          {
            field: 'body',
            message: 'send at least one of name, code, logoUrl',
          },
        ],
      });
    }

    try {
      const updated = await this.model
        .findByIdAndUpdate(id, { $set: changes }, { new: true })
        .lean<AirlineLean>()
        .exec();
      if (!updated) throw new NotFoundException('Airline not found');
      return toAirlineResponse(updated);
    } catch (error) {
      throw this.translateDuplicateCode(error);
    }
  }

  /**
   * FLT-08: an airline moderator sets (replaces) the extra-baggage price and the per-passenger limit of THEIR
   * airline. Same ownership rule as the profile edit: another airline's moderator gets 403.
   */
  async setBaggagePolicy(
    user: AuthenticatedUser,
    id: string,
    dto: SetBaggagePolicyDto,
  ): Promise<BaggagePolicyResponseDto> {
    if (user.role !== Role.AIRLINE_MODERATOR || user.airlineId !== id) {
      throw new ForbiddenException('You can only edit your own airline');
    }
    const updated = await this.model
      .findByIdAndUpdate(
        id,
        {
          $set: {
            baggagePolicy: {
              extraBagPriceCents: dto.extraBagPriceCents,
              maxExtraBags: dto.maxExtraBags,
            },
          },
        },
        { new: true, runValidators: true },
      )
      .lean<AirlineLean>()
      .exec();
    if (!updated) throw new NotFoundException('Airline not found');
    return toBaggagePolicyResponse(updated.baggagePolicy!, updated._id);
  }

  /**
   * The airline's baggage policy, or null when it has not set one yet. For booking (FLT-19) and the
   * policy shown before payment (PAY-02); they call this instead of reading the collection.
   */
  async getBaggagePolicy(
    airlineId: string,
  ): Promise<BaggagePolicyResponseDto | null> {
    const airline = await this.findById(airlineId);
    if (!airline?.baggagePolicy) return null;
    return toBaggagePolicyResponse(airline.baggagePolicy, airline._id);
  }

  /**
   * FLT-09: an airline moderator sets (replaces) the cancellation tiers of THEIR airline. Another airline's id
   * (also an unknown one) is a 403, like the profile edit. Unique thresholds are a business rule, checked here.
   * One atomic `$set` of the whole list. The refund amount is NOT calculated here: Payments' RefundCalculator does
   * that from `getCancellationTiers`.
   */
  async setCancellationPolicy(
    user: AuthenticatedUser,
    id: string,
    dto: SetCancellationPolicyDto,
  ): Promise<CancellationPolicyResponseDto> {
    if (user.role !== Role.AIRLINE_MODERATOR || user.airlineId !== id) {
      throw new ForbiddenException('You can only edit your own airline');
    }
    this.assertUniqueThresholds(dto.cancellationTiers);
    const tiers = sortTiers(dto.cancellationTiers);
    const updated = await this.model
      .findByIdAndUpdate(
        id,
        { $set: { cancellationTiers: tiers } },
        { new: true, runValidators: true },
      )
      .select('cancellationTiers')
      .lean<Pick<AirlineLean, '_id' | 'cancellationTiers'>>()
      .exec();
    if (!updated) throw new NotFoundException('Airline not found');
    return {
      airlineId: updated._id.toString(),
      cancellationTiers: sortTiers(updated.cancellationTiers ?? []),
    };
  }

  /**
   * Exported for other modules (FLT-26 cancel, PAY-02/PAY-03 policies, FLT-17): the airline's cancellation tiers,
   * largest threshold first, in the shape `RefundCalculator.compute` expects. An airline that never set tiers has
   * none ([] = nothing is refunded). An unknown or malformed id is a 404, not []: silently refunding nothing
   * would hide a bug in the caller.
   */
  async getCancellationTiers(airlineId: string): Promise<CancellationTier[]> {
    const airline = await this.findById(airlineId);
    if (!airline) throw new NotFoundException('Airline not found');
    return sortTiers(airline.cancellationTiers ?? []);
  }

  private assertUniqueThresholds(
    tiers: Array<{ daysBeforeThreshold: number }>,
  ): void {
    const seen = new Set<number>();
    const details: Array<{ field: string; message: string }> = [];
    tiers.forEach((tier, index) => {
      if (seen.has(tier.daysBeforeThreshold)) {
        details.push({
          field: `cancellationTiers.${index}.daysBeforeThreshold`,
          message: `daysBeforeThreshold ${tier.daysBeforeThreshold} is used by more than one tier`,
        });
      }
      seen.add(tier.daysBeforeThreshold);
    });
    if (details.length > 0) {
      throw new BadRequestException({ message: 'Validation failed', details });
    }
  }

  // ---- Used by other modules (Flights FLT-03, Admin ACC-13, flight search) ----

  /** The airline with this id, or null (also null for a malformed id). */
  findById(id: string): Promise<AirlineLean | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.model.findById(id).lean<AirlineLean>().exec();
  }

  async exists(id: string): Promise<boolean> {
    return (await this.findById(id)) !== null;
  }

  /** A unique-index violation on `code` becomes a 409 with a field-level detail; anything else is rethrown. */
  private translateDuplicateCode(error: unknown): unknown {
    if ((error as { code?: unknown })?.code === MONGO_DUPLICATE_KEY) {
      return new ConflictException({
        message: 'Airline code already exists',
        details: [{ field: 'code', message: 'code already exists' }],
      });
    }
    return error;
  }
}
