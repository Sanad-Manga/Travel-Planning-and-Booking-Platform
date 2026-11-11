import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, Role } from '../common';
import { AvailabilityResponseDto } from './dto/availability-response.dto';
import { CreateAvailabilityDto } from './dto/create-availability.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomResponseDto } from './dto/room-response.dto';
import { ROOM_MAX_AVAILABILITY_RANGES } from './hotels.constants';
import { Room } from './schemas/room.schema';

@Injectable()
export class RoomsService {
  constructor(@InjectModel(Room.name) private readonly rooms: Model<Room>) {}

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
    if (dto.endDate <= dto.startDate) {
      // YYYY-MM-DD strings compare like dates. Business rule, so it lives in the service.
      throw new BadRequestException({
        message: 'Validation failed',
        details: [{ field: 'endDate', message: 'endDate must be after startDate' }],
      });
    }
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

  /** Same rule as HTL-01: any hotel that is not the moderator's own (unknown and malformed ids too) answers 403. */
  private assertOwnHotel(hotelId: string, actor: AuthenticatedUser, action: string): void {
    if (actor.role !== Role.HOTEL_MODERATOR) throw new ForbiddenException('Only a hotel moderator can do this');
    if (actor.hotelId !== hotelId || !Types.ObjectId.isValid(hotelId)) {
      throw new ForbiddenException(`You can only ${action} your own hotel`);
    }
  }
}
