import { Injectable } from '@nestjs/common';

/**
 * What Hotels A (rooms, availability) needs to ask Hotels B's hotel bookings (HTL-16, Hessain). Published by
 * this ticket so both sides code against one signature; Hessain implements it on his booking collection and
 * replaces the stub provider in HotelsModule (`{ provide: RoomReservations, useClass: ... }`).
 *
 * `hasConfirmedReservation(roomId, startDate, endDate)`: true if the room has at least one CONFIRMED reservation
 * whose nights overlap the half-open range [startDate, endDate) (YYYY-MM-DD, endDate = check-out day). A
 * reservation [checkIn, checkOut) overlaps when checkIn < endDate AND checkOut > startDate.
 * Only CONFIRMED counts here (HTL-05); unexpired PENDING_PAYMENT holds are an open question for Hessain.
 */
export abstract class RoomReservations {
  abstract hasConfirmedReservation(roomId: string, startDate: string, endDate: string): Promise<boolean>;
}

/** Stub until hotel bookings exist (HTL-16): nothing is ever reserved, so no edit is blocked. */
@Injectable()
export class NoRoomReservations extends RoomReservations {
  async hasConfirmedReservation(): Promise<boolean> {
    return false;
  }
}
