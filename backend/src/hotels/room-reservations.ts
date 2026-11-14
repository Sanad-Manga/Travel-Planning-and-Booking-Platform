import { Injectable } from '@nestjs/common';

/**
 * What Hotels A (rooms, availability, search) needs to ask Hotels B's hotel bookings (HTL-16, Hessain). Published by
 * this ticket so both sides code against one signature; Hessain implements it on his booking collection and
 * replaces the stub provider in HotelsModule (`{ provide: RoomReservations, useClass: ... }`).
 *
 * `hasConfirmedReservation(roomId, startDate, endDate)`: true if the room has at least one CONFIRMED reservation
 * whose nights overlap the half-open range [startDate, endDate) (YYYY-MM-DD, endDate = check-out day). A
 * reservation [checkIn, checkOut) overlaps when checkIn < endDate AND checkOut > startDate.
 * Only CONFIRMED counts here (HTL-05); unexpired PENDING_PAYMENT holds are an open question for Hessain.
 *
 * `findReservedRoomIds(roomIds, startDate, endDate)` (HTL-11, hotel search): the SAME overlap rule, asked for many
 * rooms in ONE call, so search needs one query and not one per room. It returns the ids (strings) of the rooms that
 * cannot be sold for [startDate, endDate): a CONFIRMED reservation OR an unexpired PENDING_PAYMENT hold (HTL-18)
 * overlaps it (contracts section 8: availability counts both). Rooms with no overlap are simply not in the set.
 * Hessain: implement this in one `find({ roomId: { $in }, ... })` on the hotel bookings collection.
 */
export abstract class RoomReservations {
  abstract hasConfirmedReservation(roomId: string, startDate: string, endDate: string): Promise<boolean>;
  abstract findReservedRoomIds(roomIds: string[], startDate: string, endDate: string): Promise<Set<string>>;
}

/** Stub until hotel bookings exist (HTL-16): nothing is ever reserved, so no edit is blocked and no room is hidden. */
@Injectable()
export class NoRoomReservations extends RoomReservations {
  async hasConfirmedReservation(): Promise<boolean> {
    return false;
  }

  async findReservedRoomIds(): Promise<Set<string>> {
    return new Set();
  }
}
