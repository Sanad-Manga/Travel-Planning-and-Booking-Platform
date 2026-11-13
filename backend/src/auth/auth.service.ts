import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash, hashSync } from 'bcryptjs';
import { Types } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { AccessTokenPayload, AccountStatus, LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILED_ATTEMPTS, readTokenVersion } from '../common';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { REFRESH_TOKEN_TTL_SECONDS } from './auth-cookies';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { readJwtSecrets } from './jwt-secrets';
import { TokenRevocationService } from './token-revocation.service';

// bcrypt work factor: each +1 doubles the hashing time. 10 is the common default (~50-100 ms).
export const BCRYPT_SALT_ROUNDS = 10;

// HTTP 423 Locked: Nest's HttpStatus enum has no member for it.
const ACCOUNT_LOCKED_STATUS = 423;

export interface LoginResult {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  // A real bcrypt hash of a random string nobody knows. When the email does not exist we still run
  // bcrypt against it, so "unknown email" and "wrong password" take the same time (no timing leak).
  private readonly dummyHash = hashSync(randomBytes(16).toString('hex'), BCRYPT_SALT_ROUNDS);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly revocations: TokenRevocationService,
  ) {}

  /** Creates a USER account. Business rule (unique email) is enforced here, not only by the DTO. */
  async register(dto: RegisterDto): Promise<UserResponseDto> {
    if (await this.usersService.findByEmail(dto.email)) {
      throw this.duplicateEmail();
    }

    // bcrypt generates a random salt per call and stores it inside the hash string,
    // so two identical passwords never produce the same hash.
    const passwordHash = await hash(dto.password, BCRYPT_SALT_ROUNDS);

    // Role and status are never taken from the client: the schema defaults give USER / ACTIVE.
    // If two requests race past the check above, the unique index throws Mongo code 11000,
    // which the global filter also turns into a 409.
    const user = await this.usersService.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      consentAcceptedAt: new Date(),
    });
    return UserResponseDto.from(user);
  }

  /**
   * Order matters: the password is checked FIRST, then the status. That way "Account suspended" is only
   * revealed to someone who knows the password, and a stranger cannot probe which emails are suspended.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(dto.email, true);

    // ACC-05: while locked, even the correct password is rejected (checked before bcrypt, so no guessing during the lock).
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw this.accountLocked(user.lockedUntil);
    }

    const passwordOk = await compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !passwordOk) {
      if (user) {
        // Atomic increment; the 5th consecutive failure sets lockedUntil and is answered with 423 right away.
        const updated = await this.usersService.registerFailedLogin(user.id, LOGIN_MAX_FAILED_ATTEMPTS, LOGIN_LOCK_MINUTES);
        if (updated?.lockedUntil && updated.lockedUntil.getTime() > Date.now()) {
          throw this.accountLocked(updated.lockedUntil);
        }
      }
      throw this.invalidCredentials();
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('Account suspended');
    }
    // Only ACTIVE may log in; DEACTIVATED gets the same generic message as a wrong password.
    if (user.status !== AccountStatus.ACTIVE) {
      throw this.invalidCredentials();
    }

    if (user.mustChangePassword) {
      if (!(await this.usersService.consumeTemporaryPassword(user.id, user.passwordHash, user.tokenVersion ?? 0))) {
        throw this.invalidCredentials();
      }
      // Consumption precedes token issuance: a lost response/session requires another admin reset.
      return this.startSession(user);
    }

    // Successful login: reset the counter (skip the write when there is nothing to reset).
    if (user.failedAttempts > 0 || user.lockedUntil) {
      await this.usersService.resetFailedLogins(user.id);
    }
    return this.startSession(user);
  }

  /**
   * Stateless sliding session (ACC-06): a valid refresh token buys a NEW access token and a NEW refresh token,
   * so every refresh restarts the 30 minutes. A token whose `jti` was revoked by logout is rejected (ACC-06).
   * Role and ids are re-read from the database, never copied from the old token.
   */
  async refresh(refreshToken: unknown): Promise<LoginResult> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (!payload || (await this.revocations.isRevoked(payload.jti))) {
      throw this.invalidSession();
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || user.status !== AccountStatus.ACTIVE || payload.tokenVersion !== (user.tokenVersion ?? 0) || user.mustChangePassword) {
      throw this.invalidSession();
    }
    return this.startSession(user);
  }

  /**
   * Logout (ACC-06): revokes the refresh token's `jti` on the server. Never throws for a bad or missing token:
   * logging out without a (valid) session is a no-op, and the controller clears the cookies either way.
   * Only a token with a valid signature and expiry is stored, so nobody can fill the list with junk.
   */
  async logout(refreshToken: unknown): Promise<void> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (payload) {
      await this.revocations.revoke(payload.jti, payload.sub, new Date(payload.exp * 1000));
    }
  }

  /** The claims of a genuine, unexpired refresh token, or null. Only the REFRESH secret verifies, so an access token fails. */
  private async verifyRefreshToken(token: unknown): Promise<{ sub: string; jti: string; exp: number; tokenVersion: number } | null> {
    if (typeof token !== 'string' || token === '') return null;
    try {
      const payload = await this.jwtService.verifyAsync<{ sub?: unknown; jti?: unknown; exp?: unknown; tokenVersion?: unknown }>(token, {
        secret: readJwtSecrets(this.config).refresh,
        algorithms: ['HS256'],
      });
      const { sub, jti, exp } = payload;
      if (typeof sub !== 'string' || typeof jti !== 'string' || typeof exp !== 'number' || !Types.ObjectId.isValid(sub)) {
        return null;
      }
      const tokenVersion = readTokenVersion(payload.tokenVersion);
      if (tokenVersion === null) return null;
      return { sub, jti, exp, tokenVersion };
    } catch {
      return null;
    }
  }

  private async startSession(user: UserDocument): Promise<LoginResult> {
    const [accessToken, refreshToken] = await Promise.all([this.signAccessToken(user), this.signRefreshToken(user)]);
    return { user: UserResponseDto.from(user), accessToken, refreshToken };
  }

  /**
   * ACC-08. The password rules were already enforced by ChangePasswordDto (shared @IsValidPassword); the business
   * rule that lives here: the current password must be right.
   * A wrong current password is a field-level 400, not a 401: the user IS logged in (401 would look like a dead session).
   */
  async changePassword(userId: string, dto: ChangePasswordDto, sessionVersion = 0): Promise<boolean> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user || user.status !== AccountStatus.ACTIVE || (user.tokenVersion ?? 0) !== sessionVersion) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw this.fieldError('currentPassword', 'current password is incorrect');
    }

    if (user.mustChangePassword && dto.newPassword === dto.currentPassword) {
      throw this.fieldError('newPassword', 'new password must differ from the temporary password');
    }

    // bcrypt adds a fresh random salt, stored inside the hash string. Plaintext is never stored or logged.
    const newHash = await hash(dto.newPassword, BCRYPT_SALT_ROUNDS);
    // Compare-and-set on the old hash: if another request changed the password meanwhile, nothing is overwritten.
    const forced = user.mustChangePassword === true;
    const changed = forced
      ? await this.usersService.completeForcedPasswordChange(user.id, user.passwordHash, newHash, sessionVersion)
      : await this.usersService.replacePasswordHash(user.id, user.passwordHash, newHash, sessionVersion);
    if (!changed) {
      throw new ConflictException('Password was changed by another request. Please try again.');
    }
    return forced;
  }

  /** The user behind a valid token, for GET /auth/me. The token alone is not enough: the account must still be ACTIVE. */
  async getCurrentUser(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('Authentication required');
    }
    return UserResponseDto.from(user);
  }

  // Signature and 15-minute expiry come from the JwtModule configuration (access secret).
  private signAccessToken(user: UserDocument): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      tokenVersion: user.tokenVersion ?? 0,
      role: user.role,
      ...(user.airlineId ? { airlineId: user.airlineId.toString() } : {}),
      ...(user.hotelId ? { hotelId: user.hotelId.toString() } : {}),
    };
    return this.jwtService.signAsync(payload);
  }

  // Signed with a DIFFERENT secret than the access token, so a refresh token can never pass as an access token.
  // Carries user id and credential version; role/provider ids are re-read on exchange.
  private signRefreshToken(user: UserDocument): Promise<string> {
    return this.jwtService.signAsync(
      { sub: user.id, tokenVersion: user.tokenVersion ?? 0 },
      // Unique per-token jti supports the existing logout revocation list.
      { secret: readJwtSecrets(this.config).refresh, expiresIn: REFRESH_TOKEN_TTL_SECONDS, jwtid: randomUUID() },
    );
  }

  private invalidSession(): UnauthorizedException {
    return new UnauthorizedException('Invalid or expired session');
  }

  // 423 Locked (contracts section 3). The message says how long is left so the user knows when to retry.
  private accountLocked(lockedUntil: Date): HttpException {
    const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
    return new HttpException(
      {
        message: `Account locked after too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      },
      ACCOUNT_LOCKED_STATUS,
    );
  }

  // Identical for "no such email" and "wrong password".
  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid email or password');
  }

  // 400 in the same shape as DTO validation errors, so the frontend shows it next to the right input.
  private fieldError(field: string, message: string): BadRequestException {
    return new BadRequestException({ message: 'Validation failed', details: [{ field, message }] });
  }

  // Same shape as the validation errors so the frontend can show it next to the email field.
  private duplicateEmail(): ConflictException {
    return new ConflictException({
      message: 'Email already registered',
      details: [{ field: 'email', message: 'email already exists' }],
    });
  }
}
