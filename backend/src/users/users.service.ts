import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountStatus } from '../common';
import { User, UserDocument } from './schemas/user.schema';

/** The profile fields a user may edit (ACC-09). An empty `phone` means "remove it". */
export interface ProfileChanges {
  name?: string;
  phone?: string;
  preferredCurrency?: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  consentAcceptedAt: Date;
}

/** Data access for users. Hashing and registration rules live in AuthService; this only reads and writes. */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  /** Look up by email (case-insensitive: emails are stored lowercase). Pass `withPassword` only for login. */
  findByEmail(email: string, withPassword = false): Promise<UserDocument | null> {
    const query = this.userModel.findOne({ email: email.trim().toLowerCase() });
    return (withPassword ? query.select('+passwordHash') : query).exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  /**
   * Used by the global JwtAuthGuard on every authenticated request, so it reads only the status
   * (indexed `_id` lookup, no full document). Unknown or malformed ids are simply "not active".
   */
  async isActive(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const user = await this.userModel.findById(id).select('status').lean().exec();
    return user?.status === AccountStatus.ACTIVE;
  }

  /**
   * Applies the profile changes in ONE atomic update, only for an ACTIVE user (returns null otherwise).
   * Callers validate everything first; a single statement can never save a partial set.
   */
  updateProfile(id: string, changes: ProfileChanges): Promise<UserDocument | null> {
    const { phone, ...rest } = changes;
    const set: Record<string, string> = { ...rest };
    if (phone) set.phone = phone;
    const update = {
      ...(Object.keys(set).length > 0 ? { $set: set } : {}),
      ...(phone === '' ? { $unset: { phone: 1 } } : {}),
    };
    return this.userModel.findOneAndUpdate({ _id: id, status: AccountStatus.ACTIVE }, update, { new: true }).exec();
  }

  /**
   * Records one wrong password in a SINGLE atomic update (no read-then-write), so parallel guesses
   * cannot slip past the limit. Uses an aggregation-pipeline update:
   *  - a lock that already ended restarts the counter at 1;
   *  - a lock that is still active is left untouched;
   *  - otherwise the counter goes up by 1, and reaching `maxAttempts` sets `lockedUntil`.
   * Returns the updated user (null if it no longer exists).
   */
  registerFailedLogin(id: string, maxAttempts: number, lockMinutes: number, now = new Date()): Promise<UserDocument | null> {
    const lockUntil = new Date(now.getTime() + lockMinutes * 60_000);
    const lockActive = { $and: [{ $ne: [{ $ifNull: ['$lockedUntil', null] }, null] }, { $gt: ['$lockedUntil', now] }] };
    const lockExpired = { $and: [{ $ne: [{ $ifNull: ['$lockedUntil', null] }, null] }, { $lte: ['$lockedUntil', now] }] };
    return this.userModel
      .findByIdAndUpdate(
        id,
        [
          {
            $set: {
              failedAttempts: {
                $switch: {
                  branches: [
                    { case: lockActive, then: '$failedAttempts' },
                    { case: lockExpired, then: 1 },
                  ],
                  default: { $add: [{ $ifNull: ['$failedAttempts', 0] }, 1] },
                },
              },
            },
          },
          {
            $set: {
              lockedUntil: {
                $switch: {
                  branches: [
                    { case: lockActive, then: '$lockedUntil' },
                    { case: { $gte: ['$failedAttempts', maxAttempts] }, then: lockUntil },
                  ],
                  default: '$$REMOVE',
                },
              },
            },
          },
        ],
        { new: true },
      )
      .exec();
  }

  /** A successful login: counter back to 0 and any finished lock removed. */
  async resetFailedLogins(id: string): Promise<void> {
    await this.userModel.updateOne({ _id: id }, { $set: { failedAttempts: 0 }, $unset: { lockedUntil: 1 } }).exec();
  }

  /** New users are always role USER / status ACTIVE (schema defaults). */
  create(input: CreateUserInput): Promise<UserDocument> {
    return this.userModel.create(input);
  }
}
