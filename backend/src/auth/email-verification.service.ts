import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { EmailService } from '../email';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { EmailVerificationToken, EmailVerificationTokenDocument } from './schemas/email-verification-token.schema';

/** Assumption (ACC-02): a verification link is valid for 24 hours. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PUBLIC_API_URL = 'http://localhost:3001';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectModel(EmailVerificationToken.name) private readonly tokens: Model<EmailVerificationTokenDocument>,
    private readonly users: UsersService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Fire-and-forget for registration: never throws and is never awaited by the response path.
   * A failure is logged with the user id only (never the address, token or link).
   */
  sendInBackground(user: UserDocument): void {
    this.issueAndSend(user).catch(() => {
      this.logger.warn(`Verification email could not be sent for user ${user.id}`);
    });
  }

  /** Creates (or replaces) the user's single token and emails the link. */
  async issueAndSend(user: UserDocument): Promise<void> {
    const token = await this.issue(user.id);
    await this.email.send({
      to: user.email,
      subject: 'Verify your email address',
      text: `Welcome ${user.name}! Confirm your email address to start booking:\n\n${this.linkFor(token)}\n\nThe link is valid for 24 hours. If you did not create an account, ignore this email.`,
    });
  }

  /** Stores only the hash. Returns the raw token (the only copy), to be placed in the email. */
  async issue(userId: string, now = new Date()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.tokens
      .updateOne(
        { userId },
        { $set: { tokenHash: sha256(token), expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS) } },
        { upsert: true },
      )
      .exec();
    return token;
  }

  /**
   * Consumes the token with ONE atomic delete (exactly one of several parallel requests gets the row), then marks the
   * user verified. Unknown, expired, used and malformed tokens all give the same field-level 400.
   * An already verified user with a fresh token gets a clean 200.
   */
  async verify(token: string, now = new Date()): Promise<{ message: string }> {
    const row = await this.tokens.findOneAndDelete({ tokenHash: sha256(token), expiresAt: { $gt: now } }).exec();
    if (!row) throw this.invalidLink();

    const userId = row.userId.toString();
    if (await this.users.markEmailVerified(userId)) return { message: 'Email verified' };
    // Nothing changed: fine only when the account is ACTIVE and already verified.
    if (await this.users.isEmailVerifiedActive(userId)) return { message: 'Email already verified' };
    throw this.invalidLink();
  }

  private linkFor(token: string): string {
    const base = (this.config.get<string>('PUBLIC_API_URL') ?? DEFAULT_PUBLIC_API_URL).replace(/\/+$/, '');
    return `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  }

  private invalidLink(): BadRequestException {
    return new BadRequestException({
      message: 'Validation failed',
      details: [{ field: 'token', message: 'invalid or expired verification link' }],
    });
  }
}
