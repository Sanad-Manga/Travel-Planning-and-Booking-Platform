import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

  /** New users are always role USER / status ACTIVE (schema defaults). */
  create(input: CreateUserInput): Promise<UserDocument> {
    return this.userModel.create(input);
  }
}
