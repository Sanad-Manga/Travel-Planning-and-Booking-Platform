import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * ACC-02: one live verification link per user (collection `emailVerificationTokens`).
 * Only the SHA-256 hash of the token is stored, so a database leak cannot be used to verify accounts.
 */
@Schema({ collection: 'emailVerificationTokens', timestamps: true })
export class EmailVerificationToken {
  // unique: re-issuing replaces the row, so a user never has two live links.
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  tokenHash: string;

  // When the link was last issued; the resend cooldown compares against it inside the same atomic upsert.
  @Prop({ type: Date })
  requestedAt?: Date;

  // TTL index (expireAfterSeconds: 0): MongoDB removes the row once this moment has passed.
  // The service also filters on expiresAt, because the TTL monitor only runs about once a minute.
  @Prop({ type: Date, required: true, index: { expireAfterSeconds: 0 } })
  expiresAt: Date;
}

export type EmailVerificationTokenDocument = HydratedDocument<EmailVerificationToken>;
export const EmailVerificationTokenSchema = SchemaFactory.createForClass(EmailVerificationToken);
