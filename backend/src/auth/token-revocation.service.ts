import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RevokedToken, RevokedTokenDocument } from './schemas/revoked-token.schema';

/** The used-or-revoked refresh-token list (ACC-06 logout, issue #115 rotation). Data access only; the rules live in AuthService. */
@Injectable()
export class TokenRevocationService {
  constructor(@InjectModel(RevokedToken.name) private readonly model: Model<RevokedTokenDocument>) {}

  /** Idempotent: a single upsert, so two parallel logouts with the same token never fail or duplicate. */
  async revoke(jti: string, userId: string, expiresAt: Date): Promise<void> {
    await this.model
      .updateOne({ jti }, { $setOnInsert: { jti, userId: new Types.ObjectId(userId), expiresAt } }, { upsert: true })
      .exec();
  }

  /**
   * Single-use consumption of a refresh token (issue #115). Returns true only for the ONE request that inserted the
   * row, so two parallel refreshes with the same cookie cannot both win. The unique index on `jti` decides: the
   * upsert with $setOnInsert reports `upsertedCount` 1 for the inserter and 0 for everyone else. A real database
   * error is not caught here: it propagates (500) and is never read as "revoked" or "not revoked".
   */
  async consume(jti: string, userId: string, expiresAt: Date): Promise<boolean> {
    try {
      const result = await this.model
        .updateOne({ jti }, { $setOnInsert: { jti, userId: new Types.ObjectId(userId), expiresAt } }, { upsert: true })
        .exec();
      return result.upsertedCount === 1;
    } catch (error) {
      // Two upserts racing on a missing jti: the loser can get E11000 instead of a matched document. It lost.
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    return (await this.model.exists({ jti })) !== null;
  }
}
