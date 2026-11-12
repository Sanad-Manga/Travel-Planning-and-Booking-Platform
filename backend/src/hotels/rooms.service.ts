import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, Role } from '../common';
import { AvailabilityResponseDto } from './dto/availability-response.dto';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomResponseDto } from './dto/room-response.dto';
import { ROOM_MAX_AVAILABILITY_RANGES } from './hotels.constants';
import { RoomReservations } from './room-reservations';
import { Room } from './schemas/room.schema';

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    private readonly reservations: RoomReservations,
  ) {}

  /**
   * HTL-03: a hotel moderator adds a room to THEIR hotel. Same rule as HTL-01: any other hotel id
   * (including an unknown or malformed one) answers 403, because hotel profiles are public.
   * The "unique within the hotel" rule is settled by the unique index, not by a read-then-write.
   */
  async create(hotelId: string, dto: CreateRoomDto, actor: AuthenticatedUser): Promise<RoomResponseDto> {
    this.assertOwnHotel(hotelId, actor, 'add rooms to');

    try {
      const room = await this.rooms.create({
        hotelId: new Types.ObjectId(hotelId),
        name: dto.name,
        nameKey: dto.name.toLowerCase(),
        type: dto.type,
        beds: dto.beds,
        maxOccupancy: dto.maxOccupancy,
        pricePerNightCents: dto.pricePerNightCents,
      });
      return RoomResponseDto.from(room);
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException('A room with this number or name already exists in this hotel');
      }
      throw err;
    }
  }

  /**
   * HTL-04: a hotel moderator defines a date range when one of THEIR rooms is bookable. The range is half-open,
   * [startDate, endDate): endDate is the check-out day, so a range ending on a day and the next one starting on
   * it are adjacent, not overlapping.
   *
   * The no-overlap rule is ONE atomic conditional update on the room (no read-then-write): the range is pushed
   * only if no existing range satisfies existing.start < new.end AND existing.end > new.start. Two parallel
   * requests for overlapping ranges therefore cannot both succeed.
   */
  async addAvailability(
    hotelId: string,
    roomId: string,
    dto: CreateAvailabilityDto,
    actor: AuthenticatedUser,
  ): Promise<AvailabilityResponseDto> {
    this.assertOwnHotel(hotelId, actor, 'define availability for rooms of');
    this.assertEndAfterStart(dto.startDate, dto.endDate);
    if (!Types.ObjectId.isValid(roomId)) throw new NotFoundException('Room not found');

    const range = { _id: new Types.ObjectId(), startDate: dto.startDate, endDate: dto.endDate };
    const ownRoom = { _id: roomId, hotelId: new Types.ObjectId(hotelId) };
    const result = await this.rooms.updateOne(
      {
        ...ownRoom,
        availability: { $not: { $elemMatch: { startDate: { $lt: dto.endDate }, endDate: { $gt: dto.startDate } } } },
        [`availability.${ROOM_MAX_AVAILABILITY_RANGES - 1}`]: { $exists: false },
      },
      { $push: { availability: range } },
    );

    if (result.modifiedCount === 0) {
      // Only to choose the error. The decision itself was already made atomically above.
      const room = await this.rooms.findOne(ownRoom, { availability: 1 }).lean();
      if (!room) throw new NotFoundException('Room not found');
      if ((room.availability ?? []).length >= ROOM_MAX_AVAILABILITY_RANGES) {
        throw new ConflictException(`A room can have at most ${ROOM_MAX_AVAILABILITY_RANGES} availability ranges`);
      }
      throw new ConflictException('This range overlaps an existing availability range of the room');
    }

    return { id: range._id.toString(), roomId, hotelId, startDate: range.startDate, endDate: range.endDate };
  }

  /**
   * HTL-05: a hotel moderator edits beds, maximum occupancy and/or price of one of THEIR rooms. One atomic
   * update. Reservations are not touched: a booking must keep the price it was made with (Hotels B stores the
   * price on the booking when it is created), so changing the room price only affects bookings made afterwards.
   */
  async update(hotelId: string, roomId: string, dto: UpdateRoomDto, actor: AuthenticatedUser): Promise<RoomResponseDto> {
    this.assertOwnHotel(hotelId, actor, 'edit rooms of');
    const changes: Record<string, number> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) changes[key] = value as number;
    }
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'body', message: 'send at least one of beds, maxOccupancy, pricePerNightCents' }],
      });
    }
    if (!Types.ObjectId.isValid(roomId)) throw new NotFoundException('Room not found');

    const room = await this.rooms.findOneAndUpdate(
      { _id: roomId, hotelId: new Types.ObjectId(hotelId) },
      { $set: changes },
      { new: true, runValidators: true },
    );
    if (!room) throw new NotFoundException('Room not found');
    return RoomResponseDto.from(room);
  }

  /**
   * HTL-05: a hotel moderator changes the dates of ONE availability range of their room (shrink, extend or
   * shift; `rangeId` in the body says which). Same rules as HTL-04: endDate after startDate, no overlap with
   * the room's OTHER ranges (409).
   *
   * Dates that stop being available (old range minus new range) must have no CONFIRMED reservation, otherwise
   * 409 and nothing changes. The write is one conditional update on the room that also requires the range to
   * still have the dates we read, so two concurrent edits of the same range cannot both apply. The
   * reservation check and the write are in two collections, so a booking confirmed in the few milliseconds
   * between them is not caught without a transaction (flagged for the lead/Hessain).
   */
  async updateAvailability(
    hotelId: string,
    roomId: string,
    dto: UpdateAvailabilityDto,
    actor: AuthenticatedUser,
  ): Promise<AvailabilityResponseDto> {
    this.assertOwnHotel(hotelId, actor, 'edit availability of rooms of');
    if (dto.startDate === undefined && dto.endDate === undefined) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'body', message: 'send at least one of startDate, endDate' }],
      });
    }
    if (!Types.ObjectId.isValid(roomId)) throw new NotFoundException('Room not found');

    const ownRoom = { _id: roomId, hotelId: new Types.ObjectId(hotelId) };
    const room = await this.rooms.findOne(ownRoom, { availability: 1 }).lean();
    const current = room?.availability?.find((r) => r._id.toString() === dto.rangeId);
    if (!room || !current) throw new NotFoundException('Room or availability range not found');

    const startDate = dto.startDate ?? current.startDate;
    const endDate = dto.endDate ?? current.endDate;
    this.assertEndAfterStart(startDate, endDate);

    // The dates already are what was asked for: nothing to write (a write that changes nothing would look like a conflict).
    if (startDate === current.startDate && endDate === current.endDate) {
      return { id: dto.rangeId, roomId, hotelId, startDate, endDate };
    }

    for (const [from, to] of this.removedNights(current, { startDate, endDate })) {
      if (await this.reservations.hasConfirmedReservation(roomId, from, to)) {
        throw new ConflictException(`Availability cannot be removed for ${from} to ${to}: the room has a confirmed reservation then`);
      }
    }

    const rangeId = new Types.ObjectId(dto.rangeId);
    const result = await this.rooms.updateOne(
      {
        ...ownRoom,
        availability: {
          $not: { $elemMatch: { _id: { $ne: rangeId }, startDate: { $lt: endDate }, endDate: { $gt: startDate } } },
        },
      },
      { $set: { 'availability.$[r].startDate': startDate, 'availability.$[r].endDate': endDate } },
      { arrayFilters: [{ 'r._id': rangeId, 'r.startDate': current.startDate, 'r.endDate': current.endDate }] },
    );
    if (result.modifiedCount === 0) {
      // Either another range of the room overlaps, or the range changed since we read it.
      throw new ConflictException('This range overlaps another availability range of the room, or it was changed meanwhile');
    }
    return { id: dto.rangeId, roomId, hotelId, startDate, endDate };
  }

  /** The nights that were available in `before` and are not in `after`, as at most two [from, to) pieces. */
  private removedNights(
    before: { startDate: string; endDate: string },
    after: { startDate: string; endDate: string },
  ): Array<[string, string]> {
    if (after.endDate <= before.startDate || after.startDate >= before.endDate) return [[before.startDate, before.endDate]];
    const pieces: Array<[string, string]> = [];
    if (after.startDate > before.startDate) pieces.push([before.startDate, after.startDate]);
    if (after.endDate < before.endDate) pieces.push([after.endDate, before.endDate]);
    return pieces;
  }

  /** YYYY-MM-DD strings compare like dates. Business rule, so it lives in the service. */
  private assertEndAfterStart(startDate: string, endDate: string): void {
    if (endDate <= startDate) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'endDate', message: 'endDate must be after startDate' }],
      });
    }
  }

  /** Same rule as HTL-01: any hotel that is not the moderator's own (unknown and malformed ids too) answers 403. */
  private assertOwnHotel(hotelId: string, actor: AuthenticatedUser, action: string): void {
    if (actor.role !== Role.HOTEL_MODERATOR) throw new ForbiddenException('Only a hotel moderator can do this');
    if (actor.hotelId !== hotelId || !Types.ObjectId.isValid(hotelId)) {
      throw new ForbiddenException(`You can only ${action} your own hotel`);
    }
  }
}
