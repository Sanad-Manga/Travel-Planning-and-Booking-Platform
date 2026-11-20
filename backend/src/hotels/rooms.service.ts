import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser, Role } from '../common';
import { AvailabilityResponseDto } from './dto/availability-response.dto';
import { BlockedRangeResponseDto } from './dto/blocked-range-response.dto';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { BlockRangeDto, UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomResponseDto } from './dto/room-response.dto';
import { rangeOverlaps, todayUtc } from './hotel-availability.rules';
import { FAR_FUTURE_DATE, ROOM_MAX_AVAILABILITY_RANGES, ROOM_MAX_BLOCKED_RANGES } from './hotels.constants';
import { RoomReservations } from './room-reservations';
import { Room } from './schemas/room.schema';

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectConnection() private readonly connection: Connection,
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
   *
   * HTL-06 shares this route (docs/contracts.md section 12), so this method only decides WHICH action the body
   * asks for. Exactly one action per request: change a range (HTL-05), block dates (HTL-06) or (de)activate the
   * room (HTL-06). Mixing them would make "what happened" ambiguous when one half fails, so it is a 400.
   */
  async updateAvailability(
    hotelId: string,
    roomId: string,
    dto: UpdateAvailabilityDto,
    actor: AuthenticatedUser,
  ): Promise<AvailabilityResponseDto | BlockedRangeResponseDto | RoomResponseDto> {
    this.assertOwnHotel(hotelId, actor, 'edit availability of rooms of');

    const changesRange = dto.rangeId !== undefined || dto.startDate !== undefined || dto.endDate !== undefined;
    const actions = [changesRange, dto.block !== undefined, dto.isActive !== undefined].filter(Boolean).length;
    if (actions !== 1) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'body', message: 'send exactly one of: rangeId with startDate/endDate, block, isActive' }],
      });
    }

    if (dto.block !== undefined) return this.blockRange(hotelId, roomId, dto.block);
    if (dto.isActive !== undefined) return this.setActive(hotelId, roomId, dto.isActive);
    if (dto.rangeId === undefined) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'rangeId', message: 'rangeId is required to change a range' }],
      });
    }
    return this.changeRange(hotelId, roomId, { ...dto, rangeId: dto.rangeId });
  }

  /**
   * HTL-06: take dates out of sale for ONE of the moderator's rooms. Rejected (409) if a CONFIRMED reservation or an
   * unexpired PENDING_PAYMENT hold overlaps the dates, or if the dates overlap another block of the room.
   *
   * The overlap rule is NOT re-written here: it is Hessain's `RoomReservations.findReservedRoomIds` (the same call
   * search uses), so "reserved" means the same thing everywhere (contracts section 8).
   *
   * Concurrency: the reservation check and the write are in two collections, so both run in ONE transaction. A hold
   * created in parallel updates the same room document (HotelBookingsService.serializeRoomUpdates), so the two
   * transactions conflict and the loser is retried: either the hold sees the block, or the block sees the hold.
   * The no-overlap-between-blocks rule is, like HTL-04, one atomic conditional update.
   */
  private async blockRange(hotelId: string, roomId: string, block: BlockRangeDto): Promise<BlockedRangeResponseDto> {
    this.assertEndAfterStart(block.startDate, block.endDate);
    if (!Types.ObjectId.isValid(roomId)) throw new NotFoundException('Room not found');

    const range = { _id: new Types.ObjectId(), startDate: block.startDate, endDate: block.endDate };
    const ownRoom = { _id: new Types.ObjectId(roomId), hotelId: new Types.ObjectId(hotelId) };

    await this.connection.transaction(async (session) => {
      await this.assertRoomExists(ownRoom, session);

      const reserved = await this.reservations.findReservedRoomIds([roomId], range.startDate, range.endDate, session);
      if (reserved.has(ownRoom._id.toString())) {
        throw new ConflictException('These dates overlap a confirmed reservation or a reservation awaiting payment');
      }

      const result = await this.rooms.updateOne(
        {
          ...ownRoom,
          blockedRanges: { $not: { $elemMatch: rangeOverlaps(range.startDate, range.endDate) } },
          [`blockedRanges.${ROOM_MAX_BLOCKED_RANGES - 1}`]: { $exists: false },
        },
        { $push: { blockedRanges: range } },
        { session },
      );
      if (result.modifiedCount === 0) {
        // Only to choose the error; the decision was already made atomically above.
        const room = await this.rooms.findOne(ownRoom, { blockedRanges: 1 }).session(session).lean();
        if ((room?.blockedRanges ?? []).length >= ROOM_MAX_BLOCKED_RANGES) {
          throw new ConflictException(`A room can have at most ${ROOM_MAX_BLOCKED_RANGES} blocked ranges`);
        }
        throw new ConflictException('These dates overlap an existing blocked range of the room');
      }
    });

    return { id: range._id.toString(), roomId, hotelId, startDate: range.startDate, endDate: range.endDate };
  }

  /**
   * HTL-06: take a room out of sale (`isActive: false`) or put it back. Inactive rooms are skipped by search, the
   * free-rooms list and the hold, which all filter on `isActive`.
   *
   * Deactivating is rejected (409) while a CONFIRMED reservation or an unexpired PENDING_PAYMENT hold has not ended
   * yet, i.e. overlaps [today, forever). Past stays do not matter. Same transaction and reuse of Hessain's overlap
   * rule as `blockRange`. Setting the value the room already has is a no-op that answers 200.
   */
  private async setActive(hotelId: string, roomId: string, isActive: boolean): Promise<RoomResponseDto> {
    if (!Types.ObjectId.isValid(roomId)) throw new NotFoundException('Room not found');
    const ownRoom = { _id: new Types.ObjectId(roomId), hotelId: new Types.ObjectId(hotelId) };

    return this.connection.transaction(async (session) => {
      await this.assertRoomExists(ownRoom, session);

      if (!isActive) {
        const reserved = await this.reservations.findReservedRoomIds([roomId], todayUtc(), FAR_FUTURE_DATE, session);
        if (reserved.has(ownRoom._id.toString())) {
          throw new ConflictException('The room has a confirmed reservation or a reservation awaiting payment that has not ended yet');
        }
      }

      const room = await this.rooms.findOneAndUpdate(ownRoom, { $set: { isActive } }, { new: true, session });
      if (!room) throw new NotFoundException('Room not found');
      return RoomResponseDto.from(room);
    });
  }

  /**
   * HTL-06: delete one of the moderator's rooms, only if it was NEVER reserved. "Reserved" means any reservation
   * record that mentions the room, whatever its status (also expired, cancelled or completed ones): those records
   * keep a snapshot of the room and must not lose their reference. A room that cannot be deleted can be deactivated.
   * Same transaction as the other two actions: a hold created in parallel conflicts with the delete and one of them
   * retries, so a room can never be deleted and reserved at the same time.
   */
  async remove(hotelId: string, roomId: string, actor: AuthenticatedUser): Promise<void> {
    this.assertOwnHotel(hotelId, actor, 'delete rooms of');
    if (!Types.ObjectId.isValid(roomId)) throw new NotFoundException('Room not found');
    const ownRoom = { _id: new Types.ObjectId(roomId), hotelId: new Types.ObjectId(hotelId) };

    await this.connection.transaction(async (session) => {
      await this.assertRoomExists(ownRoom, session);
      if (await this.reservations.hasAnyReservation(roomId, session)) {
        throw new ConflictException('This room has been reserved before and cannot be deleted; deactivate it instead');
      }
      const result = await this.rooms.deleteOne(ownRoom, { session });
      if (result.deletedCount === 0) throw new NotFoundException('Room not found');
    });
  }

  /** The room must exist in the moderator's hotel BEFORE any reservation is looked at, so a 409 never reveals another hotel's room. */
  private async assertRoomExists(ownRoom: { _id: Types.ObjectId; hotelId: Types.ObjectId }, session: ClientSession): Promise<void> {
    if (!(await this.rooms.exists(ownRoom).session(session))) throw new NotFoundException('Room not found');
  }

  /** HTL-05: change the dates of one availability range (see `updateAvailability`). */
  private async changeRange(
    hotelId: string,
    roomId: string,
    dto: UpdateAvailabilityDto & { rangeId: string },
  ): Promise<AvailabilityResponseDto> {
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
