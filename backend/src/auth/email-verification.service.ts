import { BadRequestException, HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { EmailService } from '../email';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { EmailVerificationToken, EmailVerificationTokenDocument } from './schemas/email-verification-token.schema';

/** Assumption (ACC-02): a verification link is valid for 24 hours. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** A new link can be requested at most once per this many seconds. */
export const EMAIL_VERIFICATION_COOLDOWN_SECONDS = 60;
const DUPLICATE_KEY = 11000;
const DEFAULT_PUBLIC_API_URL = 'http://localhost:3001';

/** 429 for a resend inside the cooldown; the controller turns `retryAfterSeconds` into the Retry-After header. */
export class ResendCooldownException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super({ message: `A verification email was sent recently. Try again in ${retryAfterSeconds} seconds.` }, 429);
  }
}

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
    this.issue(user.id)
      .then((token) => (token ? this.email.send(this.buildEmail(user, token)) : undefined))
      .catch(() => this.logger.warn(`Verification email could not be sent for user ${user.id}`));
  }

  /**
   * Resend for the logged-in, unverified user. Already verified (flag true or missing = legacy) sends nothing.
   * Otherwise ONE conditional upsert issues the new token (the old link dies with it) or reports the cooldown as a 429;
   * the email itself goes out in the background and a failed send never changes the answer.
   */
  async resend(userId: string): Promise<{ message: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Authentication required');
    if (user.emailVerified !== false) return { message: 'Email already verified' };

    const token = await this.issue(userId);
    if (!token) throw new ResendCooldownException(await this.cooldownSecondsLeft(userId));

    this.email.send(this.buildEmail(user, token)).catch(() => {
      this.logger.warn(`Verification email could not be sent for user ${user.id}`);
    });
    return { message: 'Verification email sent' };
  }

  /**
   * Stores only the hash and returns the raw token (the only copy), or null when a link was issued less than
   * EMAIL_VERIFICATION_COOLDOWN_SECONDS ago. ONE conditional upsert, no read-then-write: the filter only matches a row
   * that is old enough (or has no requestedAt), or no row at all. A row inside the cooldown does not match, so the upsert
   * tries to insert a second row for the same userId and the unique index rejects it (11000). Two parallel first requests
   * collide the same way, so exactly one wins.
   */
  async issue(userId: string, now = new Date()): Promise<string | null> {
    const token = randomBytes(32).toString('base64url');
    const cutoff = new Date(now.getTime() - EMAIL_VERIFICATION_COOLDOWN_SECONDS * 1000);
    try {
      await this.tokens
        .updateOne(
          { userId: new Types.ObjectId(userId), $or: [{ requestedAt: { $lte: cutoff } }, { requestedAt: { $exists: false } }] },
          { $set: { tokenHash: sha256(token), expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS), requestedAt: now } },
          { upsert: true },
        )
        .exec();
      return token;
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return null;
      throw error;
    }
  }

  /** Only for the Retry-After header; the decision to refuse was already made atomically by issue(). */
  private async cooldownSecondsLeft(userId: string, now = Date.now()): Promise<number> {
    const row = await this.tokens.findOne({ userId: new Types.ObjectId(userId) }).lean().exec();
    const requestedAt = row?.requestedAt?.getTime() ?? now;
    return Math.min(EMAIL_VERIFICATION_COOLDOWN_SECONDS, Math.max(1, Math.ceil((requestedAt + EMAIL_VERIFICATION_COOLDOWN_SECONDS * 1000 - now) / 1000)));
  }

  private buildEmail(user: UserDocument, token: string): { to: string; subject: string; text: string } {
    return {
      to: user.email,
      subject: 'Verify your email address',
      text: `Hello ${user.name}! Confirm your email address to start booking:

${this.linkFor(token)}

The link is valid for 24 hours. If you did not ask for this, ignore this email.`,
    };
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
    const base = (this.config.get<string>('publicApiUrl') ?? DEFAULT_PUBLIC_API_URL).replace(/\/+$/, '');
    return `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  }

  private invalidLink(): BadRequestException {
    return new BadRequestException({
      message: 'Validation failed',
      details: [{ field: 'token', message: 'invalid or expired verification link' }],
    });
  }
}
