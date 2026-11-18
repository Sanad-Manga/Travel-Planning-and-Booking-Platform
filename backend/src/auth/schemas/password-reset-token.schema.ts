import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * ACC-07: the forgotten-password link. Collection `passwordResetTokens`; read and written only by PasswordResetService.
 * At most ONE row per user (`userId` is unique): a newer request overwrites the row in a single upsert, which is
 * what makes every older link stop working, even when two requests run in parallel.
 * Only the SHA-256 hash of the token is stored, never the token (the link in the email is the only copy).
 */
@Schema({ collection: 'passwordResetTokens', timestamps: true })
export class PasswordResetToken {
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  tokenHash: string;

  // TTL index: MongoDB removes the row shortly after this moment (30 minutes after creation). The service also
  // checks `expiresAt` itself, because the TTL monitor only runs about once a minute.
  @Prop({ type: Date, required: true, index: { expireAfterSeconds: 0 } })
  expiresAt: Date;

  // Set by the one compare-and-set that consumes the token; a used token can never be used again.
  @Prop({ type: Date })
  usedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export type PasswordResetTokenDocument = HydratedDocument<PasswordResetToken>;
export const PasswordResetTokenSchema = SchemaFactory.createForClass(PasswordResetToken);
