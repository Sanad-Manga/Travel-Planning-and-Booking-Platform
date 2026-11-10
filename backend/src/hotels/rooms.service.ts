import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, Role } from '../common';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomResponseDto } from './dto/room-response.dto';
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
    if (actor.role !== Role.HOTEL_MODERATOR) throw new ForbiddenException('Only a hotel moderator can add rooms');
    if (actor.hotelId !== hotelId || !Types.ObjectId.isValid(hotelId)) {
      throw new ForbiddenException('You can only add rooms to your own hotel');
    }

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
}
