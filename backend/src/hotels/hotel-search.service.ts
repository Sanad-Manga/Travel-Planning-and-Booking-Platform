import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PLATFORM_CURRENCY, toPaginated } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { HotelSearchQueryDto } from './dto/hotel-search-query.dto';
import { HotelSearchItemDto, HotelSearchPageDto } from './dto/hotel-search-response.dto';
import { FreeRoom, HotelAvailabilityService } from './hotel-availability.service';
import { cheapestNightlyCombination, nightsBetween, todayUtc } from './hotel-availability.rules';
import { Hotel } from './schemas/hotel.schema';

interface FieldError {
  field: string;
  message: string;
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
 * Bounded queries (independent of the number of hotels / rooms): hotels (1), city/country names (2), rooms (1),
 * reservations (1). Order: cheapest total first, then name, then id. Paging is done in memory on the matches,
 * like flight search, because the match needs the availability result.
 */
@Injectable()
export class HotelSearchService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly availability: HotelAvailabilityService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  async search(query: HotelSearchQueryDto, now: Date = new Date()): Promise<HotelSearchPageDto> {
    const { checkIn, checkOut, guests, page, limit } = query;
    const rooms = query.rooms ?? 1;
    this.assertRules(query, now);

    const place = await this.resolvePlace(query);
    const hotels = await this.hotels
      .find({ isActive: true, ...place.filter })
      .select('name cityId countryCode starRating')
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
    const matches: HotelSearchItemDto[] = [];
    for (const hotel of hotels) {
      const freeRooms = freeByHotel.get(hotel._id.toString()) ?? [];
      const nightly = cheapestNightlyCombination(freeRooms, rooms, guests);
      if (nightly === null) continue;
      matches.push({
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
      });
    }
    matches.sort((a, b) => a.cheapestTotalCents - b.cheapestTotalCents || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

    return toPaginated(matches.slice((page - 1) * limit, page * limit), matches.length, page, limit);
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
