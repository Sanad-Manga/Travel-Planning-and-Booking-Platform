import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountStatus } from '../common';
import { User, UserDocument } from './schemas/user.schema';

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

  /** Like findById, but also loads the password hash. Only for flows that must verify the current password. */
  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+passwordHash').exec();
  }

  /**
   * Compare-and-set: replaces the hash only if it is still `expectedHash`. One atomic update, so two parallel
   * password changes cannot both succeed on top of the same old password. Returns false if nothing matched.
   */
  async replacePasswordHash(id: string, expectedHash: string, newHash: string): Promise<boolean> {
    const result = await this.userModel.updateOne({ _id: id, passwordHash: expectedHash }, { $set: { passwordHash: newHash } }).exec();
    return result.modifiedCount === 1;
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

  /** New users are always role USER / status ACTIVE (schema defaults). */
  create(input: CreateUserInput): Promise<UserDocument> {
    return this.userModel.create(input);
  }
}
