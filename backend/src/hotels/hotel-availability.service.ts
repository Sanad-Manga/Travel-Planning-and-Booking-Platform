import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { coversStay } from './hotel-availability.rules';
import { RoomReservations } from './room-reservations';
import { Room } from './schemas/room.schema';

/** One room that is free for the whole stay. `roomId` is the room's `_id` as a string. */
export interface FreeRoom {
  roomId: string;
  hotelId: string;
  name: string;
  type: string;
  maxOccupancy: number;
  pricePerNightCents: number;
}

/**
 * HTL-11: THE availability question of the hotel module, asked once and reused (HTL-15 room list, ITN-25 itineraries,
 * later the hold HTL-18). Inject it from HotelsModule; never re-implement it in a controller.
 *
 *   findFreeRooms(hotelIds, checkIn, checkOut) -> FreeRoom[]   (checkIn/checkOut are YYYY-MM-DD, checkOut > checkIn)
 *
 * A room is free for the stay [checkIn, checkOut) only if ALL of these hold:
 *  1. room.isActive (HTL-06: not taken out of sale);
 *  2. its availability ranges (HTL-04, half-open [startDate, endDate)) cover EVERY night checkIn ... checkOut-1.
 *     Adjacent ranges (one ends the day the next starts) count together; a gap of one night makes the room not free;
 *  3. it is not blocked: the schema has NO blocked ranges today (HTL-05 only edits ranges and rooms), so there is
 *     nothing to check here yet. If blocked ranges are added, add the filter in this one method;
 *  4. it is not reserved or held: asked through the abstract RoomReservations (stubbed until Hessain's HTL-16/18).
 *
 * Bounded cost: 2 queries however many hotels or rooms: one on `rooms` and one RoomReservations call for all
 * candidates. It does not check the hotel itself (ACTIVE, city): the caller picks the hotels.
 * Result order: hotel as given, then price ascending, then name, then id (stable).
 */
@Injectable()
export class HotelAvailabilityService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    private readonly reservations: RoomReservations,
  ) {}

  async findFreeRooms(hotelIds: string[], checkIn: string, checkOut: string): Promise<FreeRoom[]> {
    const validIds = [...new Set(hotelIds)].filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) return [];

    // Candidates: active rooms with at least one range touching the stay. The exact "every night" test is in
    // coversStay (it has to look at several ranges together, which one Mongo condition cannot do).
    const candidates = await this.rooms
      .find({
        hotelId: { $in: validIds.map((id) => new Types.ObjectId(id)) },
        isActive: true,
        availability: { $elemMatch: { startDate: { $lt: checkOut }, endDate: { $gt: checkIn } } },
      })
      .select('hotelId name type maxOccupancy pricePerNightCents availability')
      .lean()
      .exec();

    const covered = candidates.filter((room) => coversStay(room.availability ?? [], checkIn, checkOut));
    if (covered.length === 0) return [];

    const reserved = await this.reservations.findReservedRoomIds(
      covered.map((room) => room._id.toString()),
      checkIn,
      checkOut,
    );

    const order = new Map(validIds.map((id, index) => [id, index]));
    return covered
      .filter((room) => !reserved.has(room._id.toString()))
      .map((room) => ({
        roomId: room._id.toString(),
        hotelId: room.hotelId.toString(),
        name: room.name,
        type: room.type,
        maxOccupancy: room.maxOccupancy,
        pricePerNightCents: room.pricePerNightCents,
      }))
      .sort(
        (a, b) =>
          (order.get(a.hotelId) ?? 0) - (order.get(b.hotelId) ?? 0) ||
          a.pricePerNightCents - b.pricePerNightCents ||
          a.name.localeCompare(b.name) ||
          a.roomId.localeCompare(b.roomId),
      );
  }
}
