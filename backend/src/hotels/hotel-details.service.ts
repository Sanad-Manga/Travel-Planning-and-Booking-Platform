import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FreeRoomsPageDto } from './dto/free-rooms-response.dto';
import { HotelDetailsQueryDto } from './dto/hotel-details-query.dto';
import { HotelDetailsResponseDto, HotelReviewItemDto } from './dto/hotel-details-response.dto';
import { HotelFreeRoomsService } from './hotel-free-rooms.service';
import { HotelsService } from './hotels.service';
import { Hotel } from './schemas/hotel.schema';

const PROFILE_FIELDS = 'name address cityId countryCode description photos starRating amenities';

/** What the reviews module (HTL-23/HTL-24, Hotels B) will give the page. Until then there are no reviews. */
interface ReviewSummary {
  averageRating: number | null;
  reviewCount: number;
  reviews: HotelReviewItemDto[];
}

/**
 * HTL-02: everything the public hotel page needs in one call.
 *
 * Nothing is re-implemented here, each part comes from the code that owns it:
 *  - profile: the hotel document (only an ACTIVE hotel; inactive, unknown and malformed ids are the same 404);
 *  - check-in/out times and cancellation tiers: HotelsService.getPolicies (HTL-09/HTL-10);
 *  - free rooms (only when dates are sent): HotelFreeRoomsService.listFreeRooms (HTL-15), which uses the shared
 *    HotelAvailabilityService.findFreeRooms, so the page, the room list and the search never disagree;
 *  - rating and reviews: loadReviews below, the one place Hotels B plugs the reviews module into.
 */
@Injectable()
export class HotelDetailsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly hotelsService: HotelsService,
    private readonly freeRooms: HotelFreeRoomsService,
  ) {}

  async getDetails(hotelId: string, query: HotelDetailsQueryDto): Promise<HotelDetailsResponseDto> {
    const { checkIn, checkOut, page, limit } = query;

    const hotel = /^[0-9a-f]{24}$/i.test(hotelId)
      ? await this.hotels.findOne({ _id: hotelId, isActive: true }).select(PROFILE_FIELDS).lean()
      : null;
    if (!hotel) throw new NotFoundException('Hotel not found');

    // Dates come as a pair; their order and "not in the past" rules are HTL-15's (listFreeRooms checks them).
    const stay = this.stayOf(checkIn, checkOut);

    const [policies, reviews, rooms] = await Promise.all([
      this.hotelsService.getPolicies(hotelId),
      this.loadReviews(hotelId),
      stay ? this.freeRooms.listFreeRooms(hotelId, { ...stay, page, limit }) : Promise.resolve<FreeRoomsPageDto | null>(null),
    ]);

    return {
      id: hotel._id.toString(),
      name: hotel.name,
      address: hotel.address,
      cityId: hotel.cityId,
      countryCode: hotel.countryCode,
      description: hotel.description,
      photos: (hotel.photos ?? []).map((p) => ({ id: p.id, url: p.url })),
      starRating: hotel.starRating,
      amenities: [...(hotel.amenities ?? [])],
      policies,
      ...reviews,
      rooms,
    };
  }

  /** Both dates or neither: a single date cannot describe a stay. Returns null when no stay was asked for. */
  private stayOf(checkIn?: string, checkOut?: string): { checkIn: string; checkOut: string } | null {
    if (checkIn !== undefined && checkOut !== undefined) return { checkIn, checkOut };
    if (checkIn === undefined && checkOut === undefined) return null;
    const missing = checkIn === undefined ? 'checkIn' : 'checkOut';
    throw new BadRequestException({
      message: 'Validation failed',
      details: [{ field: missing, message: `${missing} is required when the other date is sent` }],
    });
  }

  /**
   * Average rating and visible reviews of the hotel. The reviews module (HTL-23/HTL-24) is owned by Hessain and is not
   * on develop yet, so this returns the stable empty shape (averageRating null, reviewCount 0, reviews []).
   * When it merges, only this method changes: call his service here (visible, non-hidden reviews only).
   */
  private loadReviews(hotelId: string): Promise<ReviewSummary> {
    void hotelId;
    return Promise.resolve({ averageRating: null, reviewCount: 0, reviews: [] });
  }
}
