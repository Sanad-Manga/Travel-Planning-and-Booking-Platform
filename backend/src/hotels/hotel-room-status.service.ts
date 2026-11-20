import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, BookingStatus, Role, toPaginated } from '../common';
import { RoomStatusQueryDto } from './dto/room-status-query.dto';
import { RoomStatusItemDto, RoomStatusPageDto } from './dto/room-status-response.dto';
import { DateRange } from './hotel-availability.rules';
import { inclusiveDays, listDates, nextDay, RoomReservationSlice, roomStatusForDates } from './hotel-room-status.rules';
import { ROOM_STATUS_MAX_DAYS } from './hotels.constants';
import { Hotel } from './schemas/hotel.schema';
import { HotelBooking } from './schemas/hotel-booking.schema';
import { Room } from './schemas/room.schema';

interface FieldError {
  field: string;
  message: string;
}

/** `blockedRanges` is added to the room by HTL-06 (not on develop yet): read it if it is there, ignore it if not. */
type RoomWithBlocks = Room & { _id: Types.ObjectId; blockedRanges?: DateRange[] };
type BookingSlice = Pick<HotelBooking, 'checkIn' | 'checkOut' | 'status' | 'bookingReference' | 'rooms'> & { _id: Types.ObjectId };

/**
 * HTL-08: for ONE hotel and a chosen date range, the status of each room on each date: AVAILABLE, BOOKED (with the
 * reservation reference) or BLOCKED. Own hotel only (checked here, not only by the role guard).
 *
 * Cost, however many rooms or days: 3 queries (count rooms, rooms of the page, reservations of those rooms) and the
 * days are computed in memory. The per-date rule is the pure `roomStatusForDates`.
 *
 * Reservations: the same claim as the availability check (HotelBookingsService.reservedRoomIds): CONFIRMED, or
 * PENDING_PAYMENT with an unexpired hold. RoomReservations only answers "is it reserved?" (no reference), so this
 * service reads the HotelBooking collection itself, read-only.
 */
@Injectable()
export class HotelRoomStatusService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(HotelBooking.name) private readonly bookings: Model<HotelBooking>,
  ) {}

  async getRoomStatus(
    hotelId: string,
    query: RoomStatusQueryDto,
    actor: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<RoomStatusPageDto> {
    // Ownership first, in the service: another hotel (existing or not, well-formed or not) is always 403.
    if (actor.role !== Role.HOTEL_MODERATOR) throw new ForbiddenException('Only a hotel moderator can view room status');
    if (actor.hotelId !== hotelId || !Types.ObjectId.isValid(hotelId)) {
      throw new ForbiddenException('You can only view the room status of your own hotel');
    }

    const { from, to, page, limit } = query;
    this.assertRange(from, to);

    // The hotel is the moderator's own; it may be deactivated (the moderator still manages it) but must exist.
    if (!(await this.hotels.exists({ _id: hotelId }))) throw new NotFoundException('Hotel not found');

    const hotelObjectId = new Types.ObjectId(hotelId);
    const total = await this.rooms.countDocuments({ hotelId: hotelObjectId });
    const pageRooms = await this.rooms
      .find({ hotelId: hotelObjectId })
      .select('name type isActive availability blockedRanges')
      .sort({ nameKey: 1, _id: 1 })
      .collation({ locale: 'en', numericOrdering: true })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<RoomWithBlocks[]>()
      .exec();

    const reservationsByRoom = await this.loadReservations(hotelObjectId, pageRooms, from, to, now);
    const dates = listDates(from, to);
    const items: RoomStatusItemDto[] = pageRooms.map((room) => {
      const roomId = room._id.toString();
      return {
        roomId,
        name: room.name,
        type: room.type,
        isActive: room.isActive,
        days: roomStatusForDates(
          {
            isActive: room.isActive,
            availability: room.availability ?? [],
            blockedRanges: room.blockedRanges ?? [],
            reservations: reservationsByRoom.get(roomId) ?? [],
          },
          dates,
        ),
      };
    });
    return toPaginated(items, total, page, limit);
  }

  /** Reservations that claim any of these rooms on a night of [from, to]: one query, grouped by room id. */
  private async loadReservations(
    hotelId: Types.ObjectId,
    rooms: RoomWithBlocks[],
    from: string,
    to: string,
    now: Date,
  ): Promise<Map<string, RoomReservationSlice[]>> {
    const grouped = new Map<string, RoomReservationSlice[]>();
    if (rooms.length === 0) return grouped;
    const roomIds = rooms.map((room) => room._id);

    const rows = await this.bookings
      .find({
        hotelId,
        'rooms.roomId': { $in: roomIds },
        // A stay [checkIn, checkOut) touches the nights from..to when checkIn <= to and checkOut > from.
        checkIn: { $lt: nextDay(to) },
        checkOut: { $gt: from },
        $or: [
          { status: BookingStatus.CONFIRMED },
          { status: BookingStatus.PENDING_PAYMENT, holdExpiresAt: { $gt: now } },
        ],
      })
      .select('checkIn checkOut status bookingReference rooms.roomId')
      .lean<BookingSlice[]>()
      .exec();

    const wanted = new Set(roomIds.map((id) => id.toString()));
    for (const row of rows) {
      const slice: RoomReservationSlice = {
        id: row._id.toString(),
        reference: row.bookingReference ?? null,
        status: row.status,
        checkIn: row.checkIn,
        checkOut: row.checkOut,
      };
      for (const { roomId } of row.rooms) {
        const key = roomId.toString();
        if (!wanted.has(key)) continue;
        grouped.set(key, [...(grouped.get(key) ?? []), slice]);
      }
    }
    return grouped;
  }

  /** Date shape is checked by the DTO; here the order and the length (dates are YYYY-MM-DD, so strings compare as dates). */
  private assertRange(from: string, to: string): void {
    const details: FieldError[] = [];
    if (to < from) details.push({ field: 'to', message: 'to must not be before from' });
    else if (inclusiveDays(from, to) > ROOM_STATUS_MAX_DAYS) {
      details.push({ field: 'to', message: `the range cannot be longer than ${ROOM_STATUS_MAX_DAYS} days` });
    }
    if (details.length > 0) throw new BadRequestException({ message: 'Validation failed', details });
  }
}
