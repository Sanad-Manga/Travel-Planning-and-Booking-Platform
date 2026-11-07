import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A refresh token that was logged out (ACC-06). Only the token's random `jti` is stored, never the token itself.
 * Collection `revokedTokens`; read only by AuthService.refresh.
 */
@Schema({ collection: 'revokedTokens', timestamps: true })
export class RevokedToken {
  // unique: the same token can be revoked twice without creating a second entry (logout is idempotent).
  @Prop({ required: true, unique: true })
  jti: string;

  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  // TTL index: MongoDB deletes the entry shortly after this moment. By then the token has expired by itself
  // (JWT `exp`), so it can no longer be used anyway and the list never grows without bound.
  @Prop({ type: Date, required: true, index: { expireAfterSeconds: 0 } })
  expiresAt: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export type RevokedTokenDocument = HydratedDocument<RevokedToken>;
export const RevokedTokenSchema = SchemaFactory.createForClass(RevokedToken);
