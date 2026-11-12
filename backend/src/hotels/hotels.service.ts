import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthenticatedUser, MAX_IMAGES_PER_ENTITY, Role } from '../common';
import type { CancellationTier } from '../payments';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelPoliciesResponseDto } from './dto/hotel-policies-response.dto';
import { HotelResponseDto } from './dto/hotel-response.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto';
import { Hotel, HotelDocument } from './schemas/hotel.schema';

// The fields HTL-09/HTL-10 own; read together so the getter and the PUT answer stay identical.
const POLICY_FIELDS = 'checkInTime checkOutTime cancellationTiers';

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /** HTL-01: admin creates a hotel. The route is @Roles(ADMIN); the role is re-checked here too. */
  async create(dto: CreateHotelDto, actor: AuthenticatedUser): Promise<HotelResponseDto> {
    if (actor.role !== Role.ADMIN) throw new ForbiddenException('Only an admin can create a hotel');
    this.assertPhotoLimit(dto.photos);
    const countryCode = await this.countryOfCity(dto.cityId);

    try {
      const hotel = await this.hotels.create({
        name: dto.name,
        nameKey: dto.name.toLowerCase(),
        address: dto.address,
        cityId: dto.cityId,
        countryCode,
        description: dto.description,
        photos: dto.photos ?? [],
        starRating: dto.starRating,
        amenities: dto.amenities ?? [],
      });
      return HotelResponseDto.from(hotel);
    } catch (err) {
      this.rethrowDuplicate(err);
    }
  }

  /**
   * HTL-01: a hotel moderator edits ONLY their own hotel. Any other id answers 403 (contracts section 4:
   * hotel profiles are public, so there is nothing to hide). 404 only if the moderator's own hotel is gone.
   */
  async update(id: string, dto: UpdateHotelDto, actor: AuthenticatedUser): Promise<HotelResponseDto> {
    if (actor.role !== Role.HOTEL_MODERATOR) throw new ForbiddenException('Only a hotel moderator can edit a hotel');
    if (actor.hotelId !== id) throw new ForbiddenException('You can only edit your own hotel');

    this.assertPhotoLimit(dto.photos);
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) changes[key] = value;
    }
    if (Object.keys(changes).length === 0) throw new BadRequestException('Provide at least one field to update');

    if (dto.name !== undefined) changes.nameKey = dto.name.toLowerCase();
    if (dto.cityId !== undefined) changes.countryCode = await this.countryOfCity(dto.cityId);

    try {
      // One atomic update (no read-then-write); the unique index settles name clashes.
      const updated = await this.hotels.findOneAndUpdate({ _id: id }, { $set: changes }, { new: true, runValidators: true });
      if (!updated) throw new NotFoundException('Hotel not found');
      return HotelResponseDto.from(updated as HotelDocument);
    } catch (err) {
      this.rethrowDuplicate(err);
    }
  }

  /**
   * HTL-09 + HTL-10: a hotel moderator sets the standard check-in/check-out times and/or the cancellation tiers
   * of THEIR hotel. Any other hotel id (also an unknown or malformed one) answers 403, like HTL-01. Uniqueness of
   * the thresholds is a business rule, so it is checked here.
   * The write is ONE atomic `$set` of only the fields that were sent: saving the times never wipes the tiers and
   * saving the tiers never wipes the times, and two parallel requests for different fields both apply (two for the
   * same field leave one complete value, never a mix).
   * The refund amount is NOT calculated here: Payments' RefundCalculator does that from `getCancellationTiers`.
   */
  async updatePolicies(id: string, dto: UpdateHotelPoliciesDto, actor: AuthenticatedUser): Promise<HotelPoliciesResponseDto> {
    if (actor.role !== Role.HOTEL_MODERATOR) throw new ForbiddenException('Only a hotel moderator can edit hotel policies');
    if (actor.hotelId !== id) throw new ForbiddenException('You can only edit the policies of your own hotel');

    const changes: Record<string, unknown> = {};
    if (dto.checkInTime !== undefined) changes.checkInTime = dto.checkInTime;
    if (dto.checkOutTime !== undefined) changes.checkOutTime = dto.checkOutTime;
    if (dto.cancellationTiers !== undefined) {
      this.assertUniqueThresholds(dto.cancellationTiers);
      changes.cancellationTiers = dto.cancellationTiers
        .map((t) => ({ daysBeforeThreshold: t.daysBeforeThreshold, refundPercent: t.refundPercent }))
        .sort((a, b) => b.daysBeforeThreshold - a.daysBeforeThreshold);
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'body', message: 'Send at least one of checkInTime, checkOutTime, cancellationTiers' }],
      });
    }

    const updated = await this.hotels
      .findOneAndUpdate({ _id: id }, { $set: changes }, { new: true, runValidators: true })
      .select(POLICY_FIELDS)
      .lean();
    if (!updated) throw new NotFoundException('Hotel not found');
    return this.toPolicies(id, updated);
  }

  /**
   * HTL-09 + HTL-10, exported for other modules (the hotel page, the booking summary, PAY-02 policies): the check-in
   * and check-out times and the cancellation tiers of a hotel. A time that was never set is null and a hotel
   * without tiers has [] (nothing is refunded). An unknown or malformed id is a 404.
   */
  async getPolicies(hotelId: string): Promise<HotelPoliciesResponseDto> {
    if (!/^[0-9a-f]{24}$/i.test(hotelId)) throw new NotFoundException('Hotel not found');
    const hotel = await this.hotels.findById(hotelId).select(POLICY_FIELDS).lean();
    if (!hotel) throw new NotFoundException('Hotel not found');
    return this.toPolicies(hotelId, hotel);
  }

  /**
   * HTL-10, exported for other modules: the cancellation tiers of a hotel, largest threshold first, in the shape
   * `RefundCalculator.compute` expects. A hotel that never set tiers has none ([] = nothing is refunded).
   * An unknown or malformed id is a 404, not []: silently refunding nothing would hide a bug in the caller.
   */
  async getCancellationTiers(hotelId: string): Promise<CancellationTier[]> {
    return (await this.getPolicies(hotelId)).cancellationTiers;
  }

  private toPolicies(
    hotelId: string,
    stored: Pick<Hotel, 'checkInTime' | 'checkOutTime' | 'cancellationTiers'>,
  ): HotelPoliciesResponseDto {
    return {
      hotelId,
      checkInTime: stored.checkInTime ?? null,
      checkOutTime: stored.checkOutTime ?? null,
      cancellationTiers: (stored.cancellationTiers ?? [])
        .map((t) => ({ daysBeforeThreshold: t.daysBeforeThreshold, refundPercent: t.refundPercent }))
        .sort((a, b) => b.daysBeforeThreshold - a.daysBeforeThreshold),
    };
  }

  private assertUniqueThresholds(tiers: Array<{ daysBeforeThreshold: number }>): void {
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
    if (details.length > 0) throw new BadRequestException({ message: 'Validation failed', details });
  }

  /** The city must be one of the seeded ones; the hotel's country always comes from that city. */
  private async countryOfCity(cityId: string): Promise<string> {
    const city = await this.referenceData.findCityById(cityId);
    if (!city) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'cityId', message: 'cityId must be a seeded city id' }],
      });
    }
    return city.country_code;
  }

  private assertPhotoLimit(photos?: unknown[]): void {
    if (photos && photos.length > MAX_IMAGES_PER_ENTITY) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'photos', message: `A hotel can have at most ${MAX_IMAGES_PER_ENTITY} photos` }],
      });
    }
  }

  private rethrowDuplicate(err: unknown): never {
    if ((err as { code?: number })?.code === 11000) {
      throw new ConflictException('A hotel with this name already exists in this city');
    }
    throw err;
  }
}
