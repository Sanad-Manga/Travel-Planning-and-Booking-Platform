import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, BookingType } from '../common';
import { assertOwner } from '../common/ownership';
import { BookingPolicies } from './booking-provider.interface';
import { BookingProviderRegistry } from './booking-provider.registry';
import { BookingPoliciesResponseDto } from './dto/booking-policies-response.dto';
import { PolicyAcceptanceResponseDto } from './dto/policy-acceptance-response.dto';
import {
  PolicyAcceptance,
  PolicyAcceptanceLean,
} from './schemas/policy-acceptance.schema';

/**
 * PAY-02: show a booking's provider policies and record the owner's acceptance before payment.
 * The registered `BookingProvider` for the type assembles the policy content itself (FLT-09/
 * FLT-08 for a flight, HTL-09/HTL-10 for a hotel); this service only enforces ownership,
 * validates `:type`, and persists the acceptance.
 */
@Injectable()
export class PolicyAcceptanceService {
  constructor(
    private readonly registry: BookingProviderRegistry,
    @InjectModel(PolicyAcceptance.name)
    private readonly model: Model<PolicyAcceptance>,
  ) {}

  async getPolicies(
    user: AuthenticatedUser,
    typeParam: string,
    bookingId: string,
  ): Promise<BookingPoliciesResponseDto> {
    const type = this.parseBookingType(typeParam);
    const policies = await this.loadPolicies(type, bookingId);
    assertOwner(user, { ownerId: policies.ownerId }, `${type} booking not found`);
    return this.toResponse(type, bookingId, policies);
  }

  async acceptPolicies(
    user: AuthenticatedUser,
    typeParam: string,
    bookingId: string,
  ): Promise<PolicyAcceptanceResponseDto> {
    const type = this.parseBookingType(typeParam);
    const policies = await this.loadPolicies(type, bookingId);
    assertOwner(user, { ownerId: policies.ownerId }, `${type} booking not found`);

    const acceptedAt = new Date();
    const row = await this.model
      .findOneAndUpdate(
        {
          bookingType: type,
          bookingId: new Types.ObjectId(bookingId),
          userId: new Types.ObjectId(user.userId),
        },
        { $set: { acceptedAt } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<PolicyAcceptanceLean>()
      .exec();

    return {
      bookingType: row.bookingType,
      bookingId: row.bookingId.toString(),
      userId: row.userId.toString(),
      acceptedAt: row.acceptedAt,
    };
  }

  /**
   * PAY-01's seam: call before starting a payment. Looks up by booking only — ownership was
   * already enforced when the acceptance was recorded, so existence is enough here.
   */
  async assertAccepted(type: BookingType, bookingId: string): Promise<void> {
    if (!Types.ObjectId.isValid(bookingId)) {
      throw new ConflictException('Policies must be accepted before payment');
    }
    const accepted = await this.model
      .exists({ bookingType: type, bookingId: new Types.ObjectId(bookingId) })
      .exec();
    if (!accepted) {
      throw new ConflictException('Policies must be accepted before payment');
    }
  }

  private async loadPolicies(
    type: BookingType,
    bookingId: string,
  ): Promise<BookingPolicies> {
    const provider = this.registry.tryGet(type);
    if (!provider) {
      throw new NotFoundException(
        `No booking provider registered for ${type} yet`,
      );
    }
    const policies = await provider.getPolicies(bookingId);
    if (!policies) {
      throw new NotFoundException(`${type} booking not found`);
    }
    return policies;
  }

  private parseBookingType(value: string): BookingType {
    const type = value?.toUpperCase();
    if (type !== BookingType.FLIGHT && type !== BookingType.HOTEL) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'type', message: 'type must be FLIGHT or HOTEL' }],
      });
    }
    return type;
  }

  private toResponse(
    type: BookingType,
    bookingId: string,
    policies: BookingPolicies,
  ): BookingPoliciesResponseDto {
    return {
      bookingType: type,
      bookingId,
      cancellationTiers: policies.cancellationTiers,
      ...(type === BookingType.FLIGHT
        ? { baggagePolicy: policies.baggagePolicy ?? null }
        : {
            checkInTime: policies.checkInTime ?? null,
            checkOutTime: policies.checkOutTime ?? null,
          }),
    };
  }
}
