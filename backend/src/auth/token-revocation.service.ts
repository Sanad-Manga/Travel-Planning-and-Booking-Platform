import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RevokedToken, RevokedTokenDocument } from './schemas/revoked-token.schema';

/** The refresh-token revocation list (ACC-06). Data access only; the rules live in AuthService. */
@Injectable()
export class TokenRevocationService {
  constructor(@InjectModel(RevokedToken.name) private readonly model: Model<RevokedTokenDocument>) {}

  /** Idempotent: a single upsert, so two parallel logouts with the same token never fail or duplicate. */
  async revoke(jti: string, userId: string, expiresAt: Date): Promise<void> {
    await this.model
      .updateOne({ jti }, { $setOnInsert: { jti, userId: new Types.ObjectId(userId), expiresAt } }, { upsert: true })
      .exec();
  }

  async isRevoked(jti: string): Promise<boolean> {
    return (await this.model.exists({ jti })) !== null;
  }
}
