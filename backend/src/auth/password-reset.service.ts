import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { hash } from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { AccountStatus } from '../common';
import { EmailService } from '../email';
import { UsersService } from '../users/users.service';
import { RESET_TOKEN_ERROR_MESSAGE, RESET_TOKEN_TTL_MINUTES } from './auth.constants';
import { BCRYPT_SALT_ROUNDS } from './auth.service';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetToken, PasswordResetTokenDocument } from './schemas/password-reset-token.schema';

const DUPLICATE_KEY = 11000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** ACC-07: email-based forgotten password. Request side (`requestReset`) and redeem side (`reset`). */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  // Background jobs started by requestReset; kept so shutdown and tests can wait for them.
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly users: UsersService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @InjectModel(PasswordResetToken.name) private readonly tokens: Model<PasswordResetTokenDocument>,
  ) {}

  /**
   * Starts the work and returns at once, WITHOUT waiting for it: the HTTP response is decided before the lookup, so its
   * timing and status cannot reveal whether the email exists, is ACTIVE, or whether the mail server is slow or down.
   */
  requestReset(email: string): void {
    const job: Promise<void> = this.process(email).finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** Resolves when every background job started by requestReset has finished (tests, graceful shutdown). */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.whenIdle();
  }

  /** Never rejects: a failure is logged (user id and error type only, never the token, link or address) and swallowed. */
  private async process(email: string): Promise<void> {
    let userId: string | undefined;
    try {
      const user = await this.users.findByEmail(email);
      // Unknown, SUSPENDED and DEACTIVATED accounts get no email; the caller cannot tell the difference.
      if (!user || user.status !== AccountStatus.ACTIVE) return;
      userId = user.id;

      const token = randomBytes(32).toString('base64url');
      await this.storeToken(user.id, token);
      await this.email.send(this.buildEmail(user.email, token));
    } catch (error) {
      const type = error instanceof Error ? error.name : 'unknown error';
      this.logger.error(userId ? `Password reset email failed for user ${userId} (${type})` : `Password reset request failed (${type})`);
    }
  }

  /**
   * ONE upsert on `userId`: the new hash and expiry overwrite the previous row and clear `usedAt`, so older links die
   * atomically. Two parallel requests can never leave two live tokens (there is only one row to hold one).
   */
  private async storeToken(userId: string, token: string): Promise<void> {
    const update = {
      $set: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000) },
      $unset: { usedAt: 1 as const },
    };
    // A real ObjectId: on an upsert the filter value is what gets inserted, and a string would be stored as a string.
    const filter = { userId: new Types.ObjectId(userId) };
    try {
      await this.tokens.findOneAndUpdate(filter, update, { upsert: true }).exec();
    } catch (error) {
      // Two parallel first requests can both try to insert the row; the loser simply overwrites it.
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      await this.tokens.findOneAndUpdate(filter, update, { upsert: true }).exec();
    }
  }

  /**
   * Order: the DTO was already validated (a weak password is a 400 on `newPassword` and touches nothing).
   * Then: find a live token -> the account is still ACTIVE -> consume the token with ONE compare-and-set -> write the
   * password with a compare-and-set on the old hash. Every token failure is the same 400 on `token`.
   */
  async reset(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = hashToken(dto.token);
    const live = () => ({ tokenHash, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } });

    const row = await this.tokens.findOne(live()).lean().exec();
    if (!row) throw this.invalidToken();

    const user = await this.users.findByIdWithPassword(row.userId.toString());
    if (!user || user.status !== AccountStatus.ACTIVE) throw this.invalidToken(); // nothing consumed

    const newHash = await hash(dto.newPassword, BCRYPT_SALT_ROUNDS);

    // The single winner of parallel requests: usedAt is set only if it is still unset and the token is still in time.
    const consumed = await this.tokens.findOneAndUpdate(live(), { $set: { usedAt: new Date() } }).exec();
    if (!consumed) throw this.invalidToken();

    // Compare-and-set on the old hash: if the password changed meanwhile nothing is overwritten. Bumps tokenVersion
    // (all sessions die), clears temporary-password state, resets the failed-login counter and any lock.
    if (!(await this.users.completeEmailPasswordReset(user.id, user.passwordHash, newHash))) throw this.invalidToken();
  }

  private buildEmail(to: string, token: string): { to: string; subject: string; text: string; html: string } {
    const base = (this.config.get<string>('frontendUrl') ?? 'http://localhost:3000').replace(/\/+$/, '');
    const link = `${base}/reset-password?token=${token}`;
    return {
      to,
      subject: 'Reset your password',
      text:
        `We received a request to reset your password.\n\nOpen this link to choose a new one (it works once and expires in ${RESET_TOKEN_TTL_MINUTES} minutes):\n${link}\n\n` +
        'If you did not ask for this, you can ignore this email; your password stays the same.',
      html:
        '<p>We received a request to reset your password.</p>' +
        `<p><a href="${link}">Choose a new password</a><br>The link works once and expires in ${RESET_TOKEN_TTL_MINUTES} minutes.</p>` +
        '<p>If you did not ask for this, you can ignore this email; your password stays the same.</p>',
    };
  }

  // Same shape as DTO validation errors, and ONE message, so the reason (unknown / expired / used / replaced) never leaks.
  private invalidToken(): BadRequestException {
    return new BadRequestException({ message: 'Validation failed', details: [{ field: 'token', message: RESET_TOKEN_ERROR_MESSAGE }] });
  }
}
