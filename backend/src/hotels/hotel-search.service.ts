import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PLATFORM_CURRENCY, toPaginated } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { HotelSearchQueryDto, HotelSortBy, HotelSortOrder } from './dto/hotel-search-query.dto';
import { HotelSearchItemDto, HotelSearchPageDto } from './dto/hotel-search-response.dto';
import { FreeRoom, HotelAvailabilityService } from './hotel-availability.service';
import { cheapestNightlyCombination, nightsBetween, todayUtc } from './hotel-availability.rules';
import { Hotel } from './schemas/hotel.schema';

interface FieldError {
  field: string;
  message: string;
}

/** A hotel that passed the availability check, with the values the HTL-12 filters and sorts need. */
interface SearchMatch {
  item: HotelSearchItemDto;
  /** Cheapest price per night of the requested rooms, in integer cents. */
  nightly: number;
  /** Average review rating, or null when the hotel has no visible review yet. */
  rating: number | null;
}

/**
 * HTL-11: guest or user searches ACTIVE hotels by city OR country, dates, guests and rooms.
 *
 * Matching: `cityId` is a seeded city_id, `countryCode` a seeded country code (hotels store both). Exactly one of
 * them is required (none or both = 400); an id that is not seeded is a 400 too, not an empty list, so a typo is visible.
 *
 * A hotel is returned if it is ACTIVE and at least `rooms` of its rooms are free for every night
 * (HotelAvailabilityService) AND some choice of exactly `rooms` of those rooms has a combined maxOccupancy >= guests.
 * That is a feasibility check, not a booking: nothing is held or reserved, and the booking (HTL-16) re-checks.
 *
 * HTL-12: the matches can be narrowed by an inclusive price range per night (the cheapest qualifying room or
 * combination, the same figure the price sort uses) and by a minimum average review rating; a hotel without a rating
 * is excluded as soon as `minRating` is set. `sort=price|rating` plus `order=asc|desc` order the matches; unrated
 * hotels come last in both rating directions. Without new parameters the old HTL-11 order (cheapest first, then name,
 * then id) is unchanged, because the price sort is the default.
 *
 * Bounded queries (independent of the number of hotels / rooms): hotels (1), city/country names (2), rooms (1),
 * reservations (1). Paging is done in memory on the matches, like flight search, because the match needs the
 * availability result.
 */
@Injectable()
export class HotelSearchService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly availability: HotelAvailabilityService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  async search(query: HotelSearchQueryDto, now: Date = new Date()): Promise<HotelSearchPageDto> {
    const { checkIn, checkOut, guests, page, limit, minPrice, maxPrice, minRating } = query;
    const rooms = query.rooms ?? 1;
    const sort = query.sort ?? HotelSortBy.PRICE;
    const order = query.order ?? HotelSortOrder.ASC;
    this.assertRules(query, now);

    const place = await this.resolvePlace(query);
    const hotels = await this.hotels
      .find({ isActive: true, ...place.filter })
      .select('name cityId countryCode starRating averageRating')
      .lean()
      .exec();

    const free = await this.availability.findFreeRooms(
      hotels.map((h) => h._id.toString()),
      checkIn,
      checkOut,
    );
    const freeByHotel = new Map<string, FreeRoom[]>();
    for (const room of free) freeByHotel.set(room.hotelId, [...(freeByHotel.get(room.hotelId) ?? []), room]);

    const nights = nightsBetween(checkIn, checkOut);
    const matches: SearchMatch[] = [];
    for (const hotel of hotels) {
      const freeRooms = freeByHotel.get(hotel._id.toString()) ?? [];
      const nightly = cheapestNightlyCombination(freeRooms, rooms, guests);
      if (nightly === null) continue;
      if (minPrice !== undefined && nightly < minPrice) continue;
      if (maxPrice !== undefined && nightly > maxPrice) continue;
      const rating = hotel.averageRating ?? null;
      if (minRating !== undefined && (rating === null || rating < minRating)) continue;
      matches.push({
        nightly,
        rating,
        item: {
          id: hotel._id.toString(),
          name: hotel.name,
          cityId: hotel.cityId,
          cityName: place.cityNames.get(hotel.cityId) ?? hotel.cityId,
          countryCode: hotel.countryCode,
          countryName: place.countryName,
          starRating: hotel.starRating,
          freeRooms: freeRooms.length,
          nights,
          cheapestTotalCents: nightly * nights,
          currency: PLATFORM_CURRENCY,
        },
      });
    }
    this.sortMatches(matches, sort, order);

    return toPaginated(matches.slice((page - 1) * limit, page * limit).map((match) => match.item), matches.length, page, limit);
  }

  /**
   * HTL-12: price is the nightly figure the range filters on; rating is the hotel's average review rating. Ties fall
   * back to name then id, so pages never repeat or skip a hotel. Unrated hotels are last for BOTH rating directions
   * (a descending list must not start with "no rating").
   */
  private sortMatches(matches: SearchMatch[], sort: HotelSortBy, order: HotelSortOrder): void {
    const direction = order === HotelSortOrder.DESC ? -1 : 1;
    matches.sort((a, b) => {
      if (sort === HotelSortBy.RATING) {
        if (a.rating !== b.rating) {
          if (a.rating === null) return 1;
          if (b.rating === null) return -1;
          return (a.rating - b.rating) * direction;
        }
      } else if (a.nightly !== b.nightly) {
        return (a.nightly - b.nightly) * direction;
      }
      return a.item.name.localeCompare(b.item.name) || a.item.id.localeCompare(b.item.id);
    });
  }

  /** Business rules of the query (field-level 400s). Dates are YYYY-MM-DD so string comparison is date comparison. */
  private assertRules(query: HotelSearchQueryDto, now: Date): void {
    const details: FieldError[] = [];
    if (!query.cityId && !query.countryCode) {
      details.push({ field: 'cityId', message: 'Provide cityId or countryCode' });
    } else if (query.cityId && query.countryCode) {
      details.push({ field: 'countryCode', message: 'Provide either cityId or countryCode, not both' });
    }
    if (query.checkOut <= query.checkIn) details.push({ field: 'checkOut', message: 'checkOut must be after checkIn' });
    if (query.checkIn < todayUtc(now)) details.push({ field: 'checkIn', message: 'checkIn cannot be in the past' });
    if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
      details.push({ field: 'minPrice', message: 'minPrice must not be greater than maxPrice' });
    }
    if (details.length > 0) throw new BadRequestException({ message: 'Validation failed', details });
  }

  private async resolvePlace(query: HotelSearchQueryDto): Promise<{
    filter: { cityId: string } | { countryCode: string };
    cityNames: Map<string, string>;
    countryName: string;
  }> {
    if (query.cityId) {
      const city = await this.referenceData.findCityById(query.cityId);
      if (!city) throw this.unknown('cityId', 'cityId must be a seeded city id');
      const country = await this.referenceData.findCountryById(city.country_code);
      return {
        filter: { cityId: city.city_id },
        cityNames: new Map([[city.city_id, city.name]]),
        countryName: country?.name ?? city.country_code,
      };
    }
    const country = await this.referenceData.findCountryById(query.countryCode as string);
    if (!country) throw this.unknown('countryCode', 'countryCode must be a seeded country code');
    const cities = await this.referenceData.listCitiesByCountry(country.code);
    return {
      filter: { countryCode: country.code },
      cityNames: new Map(cities.map((c) => [c.city_id, c.name])),
      countryName: country.name,
    };
  }

  private unknown(field: string, message: string): BadRequestException {
    return new BadRequestException({ message: 'Validation failed', details: [{ field, message }] });
  }
}
