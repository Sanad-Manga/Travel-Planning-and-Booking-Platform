import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PLATFORM_CURRENCY, toPaginated } from '../common';
import { FreeRoomsQueryDto } from './dto/free-rooms-query.dto';
import { FreeRoomItemDto, FreeRoomsPageDto } from './dto/free-rooms-response.dto';
import { HotelAvailabilityService } from './hotel-availability.service';
import { nightsBetween, stayTotalCents, todayUtc } from './hotel-availability.rules';
import { Hotel } from './schemas/hotel.schema';

interface FieldError {
  field: string;
  message: string;
}

/**
 * HTL-15: the rooms of ONE hotel that are free for every night of the searched stay, with the price of the stay.
 *
 * The availability rule is NOT written here: it is HotelAvailabilityService.findFreeRooms (HTL-11), so this list and
 * the hotel search can never disagree. This service only checks the hotel and the dates, and adds nights and totals.
 * Order (from findFreeRooms): price per night, then name, then id. Paging is in memory on that list.
 * Nothing is held or booked: the client picks roomIds from the list and sends them to the booking (HTL-16).
 */
@Injectable()
export class HotelFreeRoomsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly availability: HotelAvailabilityService,
  ) {}

  async listFreeRooms(hotelId: string, query: FreeRoomsQueryDto, now: Date = new Date()): Promise<FreeRoomsPageDto> {
    const { checkIn, checkOut, page, limit } = query;
    this.assertDates(checkIn, checkOut, now);

    // Unknown, malformed or deactivated hotels are all the same 404 (a deactivated hotel is not bookable).
    const exists = /^[0-9a-f]{24}$/i.test(hotelId) && (await this.hotels.exists({ _id: hotelId, isActive: true }));
    if (!exists) throw new NotFoundException('Hotel not found');

    const free = await this.availability.findFreeRooms([hotelId], checkIn, checkOut);
    const nights = nightsBetween(checkIn, checkOut);
    const items: FreeRoomItemDto[] = free.map((room) => ({
      roomId: room.roomId,
      name: room.name,
      type: room.type,
      beds: room.beds,
      maxOccupancy: room.maxOccupancy,
      pricePerNightCents: room.pricePerNightCents,
      totalCents: stayTotalCents(room.pricePerNightCents, nights),
      checkIn,
      checkOut,
      nights,
      currency: PLATFORM_CURRENCY,
    }));
    return toPaginated(items.slice((page - 1) * limit, page * limit), items.length, page, limit);
  }

  /** Same date rules as the hotel search. Dates are YYYY-MM-DD, so string comparison is date comparison. */
  private assertDates(checkIn: string, checkOut: string, now: Date): void {
    const details: FieldError[] = [];
    if (checkOut <= checkIn) details.push({ field: 'checkOut', message: 'checkOut must be after checkIn' });
    if (checkIn < todayUtc(now)) details.push({ field: 'checkIn', message: 'checkIn cannot be in the past' });
    if (details.length > 0) throw new BadRequestException({ message: 'Validation failed', details });
  }
}
