import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types, UpdateQuery } from 'mongoose';
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

  private async writeCredentials(filter: FilterQuery<UserDocument>, update: UpdateQuery<UserDocument>) {
    try {
      return await this.userModel.updateOne(filter, update).exec();
    } catch {
      // Driver diagnostics can embed the update document/hash; never forward them to the global logger.
      throw new InternalServerErrorException('Credential update failed; credentials may have changed');
    }
  }

  /** Look up by email (case-insensitive: emails are stored lowercase). Pass `withPassword` only for login. */
  findByEmail(email: string, withPassword = false): Promise<UserDocument | null> {
    const query = this.userModel.findOne({ email: email.trim().toLowerCase() });
    return (withPassword ? query.select('+passwordHash +temporaryPasswordExpiresAt +temporaryPasswordConsumed') : query).exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  /** Like findById, but also loads the password hash. Only for flows that must verify the current password. */
  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+passwordHash +temporaryPasswordExpiresAt +temporaryPasswordConsumed').exec();
  }

  /**
   * Compare-and-set: replaces the hash only if it is still `expectedHash`. One atomic update, so two parallel
   * password changes cannot both succeed on top of the same old password. Returns false if nothing matched.
   */
  async replacePasswordHash(id: string, expectedHash: string, newHash: string, version = 0): Promise<boolean> {
    const result = await this.writeCredentials(
      {
        _id: id,
        passwordHash: expectedHash,
        status: AccountStatus.ACTIVE,
        mustChangePassword: { $ne: true },
        tokenVersion: version === 0 ? { $in: [0, null] } : version,
      },
      { $set: { passwordHash: newHash } },
    );
    return result.modifiedCount === 1;
  }

  async getAuthenticationState(id: string): Promise<{ active: boolean; tokenVersion: number; mustChangePassword: boolean } | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const user = await this.userModel.findById(id).select('status tokenVersion mustChangePassword').lean().exec();
    return user ? {
      active: user.status === AccountStatus.ACTIVE,
      tokenVersion: user.tokenVersion ?? 0,
      mustChangePassword: user.mustChangePassword === true,
    } : null;
  }

  /** One winner only; incorrect passwords never reach this claim. Expiration is checked at the write. */
  async consumeTemporaryPassword(id: string, expectedHash: string, version: number): Promise<boolean> {
    const now = new Date();
    const result = await this.writeCredentials(
      {
        _id: id,
        passwordHash: expectedHash,
        tokenVersion: version,
        status: AccountStatus.ACTIVE,
        mustChangePassword: true,
        temporaryPasswordConsumed: false,
        temporaryPasswordExpiresAt: { $gt: now },
        $or: [
          { lockedUntil: { $exists: false } },
          { lockedUntil: null },
          { lockedUntil: { $lte: now } },
        ],
      },
      {
        $set: { temporaryPasswordConsumed: true, failedAttempts: 0 },
        $unset: { lockedUntil: 1 },
      },
    );
    return result.modifiedCount === 1;
  }

  async completeForcedPasswordChange(id: string, expectedHash: string, newHash: string, version: number): Promise<boolean> {
    const result = await this.writeCredentials(
      {
        _id: id,
        passwordHash: expectedHash,
        tokenVersion: version,
        status: AccountStatus.ACTIVE,
        mustChangePassword: true,
        temporaryPasswordConsumed: true,
      },
      {
        $set: { passwordHash: newHash, mustChangePassword: false },
        $inc: { tokenVersion: 1 },
        $unset: { temporaryPasswordExpiresAt: 1, temporaryPasswordConsumed: 1 },
      },
    );
    return result.modifiedCount === 1;
  }

  /**
   * Existing status-only lookup retained for consumers. The global guard uses getAuthenticationState
   * to also check version/forced state. Unknown or malformed ids are simply "not active".
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
   * ACC-12: ONE conditional update, ACTIVE -> DEACTIVATED, filtered on the id AND the current status (no
   * read-then-write). Returns false when the user was not ACTIVE any more (e.g. a parallel call won).
   */
  async deactivate(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await this.userModel
      .updateOne({ _id: id, status: AccountStatus.ACTIVE }, { $set: { status: AccountStatus.DEACTIVATED } })
      .exec();
    return result.modifiedCount === 1;
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
