import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Collection `rooms`: ONE individually bookable unit of a hotel (HTL-03).
 * Hotels B (search, holds, bookings) reserves rooms by `_id`; availability (HTL-04) and the
 * edit/delete tickets (HTL-05/06) build on this. Agreed fields for Hotels B: roomId (= `_id`),
 * pricePerNightCents, maxOccupancy, isActive. Do not rename them without telling that owner.
 */
@Schema({ collection: 'rooms', timestamps: true })
export class Room {
  // Reference to the hotel (shared, independently queried data, so a reference and not embedding).
  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  // Room number or name as the moderator typed it (e.g. "101" or "Sea View Suite").
  @Prop({ required: true, trim: true })
  name: string;

  // Lower-cased name, only used to enforce "unique within the hotel" case-insensitively.
  @Prop({ required: true, select: false })
  nameKey: string;

  // Free text such as "Double", "Suite" (no fixed list in the requirement).
  @Prop({ required: true, trim: true })
  type: string;

  @Prop({ required: true, min: 1 })
  beds: number;

  @Prop({ required: true, min: 1 })
  maxOccupancy: number;

  // Integer minor units of the platform currency (PAY-04). Never a float.
  @Prop({ required: true, min: 1, validate: { validator: Number.isInteger, message: 'pricePerNightCents must be an integer' } })
  pricePerNightCents: number;

  // false = taken out of sale by the moderator (HTL-06). New rooms are active.
  @Prop({ default: true })
  isActive: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);

// A room number/name is unique within its hotel (case-insensitive via nameKey). The index settles races.
RoomSchema.index({ hotelId: 1, nameKey: 1 }, { unique: true });
