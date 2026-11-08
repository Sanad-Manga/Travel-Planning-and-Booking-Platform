import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AccountStatus, PLATFORM_CURRENCY, Role } from '../../common';

/**
 * The shared User schema (collection `users`). Other modules (Admin, Blog, Itineraries, bookings)
 * reference it by `_id`, so do not rename these fields without telling the team.
 */
@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  // unique: true creates a unique index; lowercase + trim keep "A@x.com " and "a@x.com" the same account.
  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  email: string;

  // select: false -> the hash is NOT loaded by default; code that needs it must ask with .select('+passwordHash').
  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ type: String, enum: Object.values(Role), default: Role.USER })
  role: Role;

  @Prop({ type: String, enum: Object.values(AccountStatus), default: AccountStatus.ACTIVE })
  status: AccountStatus;

  // A moderator has exactly one of these (set by Admin when the moderator is created).
  @Prop({ type: Types.ObjectId })
  airlineId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  hotelId?: Types.ObjectId;

  // When the user accepted the terms / privacy policy at registration.
  @Prop({ required: true })
  consentAcceptedAt: Date;

  @Prop({ default: PLATFORM_CURRENCY })
  preferredCurrency: string;

  // Optional contact number (ACC-09), stored normalized: optional "+" and 7 to 15 digits. Absent when never set or removed.
  @Prop({ type: String })
  phone?: string;

  // Login lockout (ACC-05). Consecutive wrong passwords; reset to 0 by a successful login.
  @Prop({ type: Number, default: 0 })
  failedAttempts: number;

  // While this is in the future, login is rejected with 423 even for the right password.
  @Prop({ type: Date })
  lockedUntil?: Date;

  // Added by `timestamps: true`; declared so TypeScript knows about them.
  createdAt?: Date;
  updatedAt?: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
