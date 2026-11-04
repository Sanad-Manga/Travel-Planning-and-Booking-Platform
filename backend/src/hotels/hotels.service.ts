import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthenticatedUser, MAX_IMAGES_PER_ENTITY, Role } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelResponseDto } from './dto/hotel-response.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { Hotel, HotelDocument } from './schemas/hotel.schema';

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
