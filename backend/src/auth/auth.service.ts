import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash, hashSync } from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { AccessTokenPayload, AccountStatus } from '../common';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { REFRESH_TOKEN_TTL_SECONDS } from './auth-cookies';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { readJwtSecrets } from './jwt-secrets';

// bcrypt work factor: each +1 doubles the hashing time. 10 is the common default (~50-100 ms).
export const BCRYPT_SALT_ROUNDS = 10;

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
    const passwordOk = await compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !passwordOk) {
      throw this.invalidCredentials();
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('Account suspended');
    }
    // Only ACTIVE may log in; DEACTIVATED gets the same generic message as a wrong password.
    if (user.status !== AccountStatus.ACTIVE) {
      throw this.invalidCredentials();
    }

    return this.startSession(user);
  }

  /**
   * Stateless sliding session (ACC-06): a valid refresh token buys a NEW access token and a NEW refresh token,
   * so every refresh restarts the 30 minutes. Server-side revocation and logout come in SCRUM-38.
   * Role and ids are re-read from the database, never copied from the old token.
   */
  async refresh(refreshToken: unknown): Promise<LoginResult> {
    if (typeof refreshToken !== 'string' || refreshToken === '') {
      throw this.invalidSession();
    }

    let payload: { sub?: unknown };
    try {
      // Only the REFRESH secret verifies here, so an access token is rejected (signature mismatch).
      payload = await this.jwtService.verifyAsync<{ sub?: unknown }>(refreshToken, {
        secret: readJwtSecrets(this.config).refresh,
        algorithms: ['HS256'],
      });
    } catch {
      throw this.invalidSession();
    }
    if (typeof payload.sub !== 'string') {
      throw this.invalidSession();
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw this.invalidSession();
    }
    return this.startSession(user);
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
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw this.fieldError('currentPassword', 'current password is incorrect');
    }

    // bcrypt adds a fresh random salt, stored inside the hash string. Plaintext is never stored or logged.
    const newHash = await hash(dto.newPassword, BCRYPT_SALT_ROUNDS);
    // Compare-and-set on the old hash: if another request changed the password meanwhile, nothing is overwritten.
    if (!(await this.usersService.replacePasswordHash(user.id, user.passwordHash, newHash))) {
      throw new ConflictException('Password was changed by another request. Please try again.');
    }
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
      role: user.role,
      ...(user.airlineId ? { airlineId: user.airlineId.toString() } : {}),
      ...(user.hotelId ? { hotelId: user.hotelId.toString() } : {}),
    };
    return this.jwtService.signAsync(payload);
  }

  // Signed with a DIFFERENT secret than the access token, so a refresh token can never pass as an access token.
  // It only carries the user id; role and ids are re-read from the database when it is exchanged (Sprint 2).
  private signRefreshToken(user: UserDocument): Promise<string> {
    return this.jwtService.signAsync(
      { sub: user.id },
      // jwtid = random `jti` claim, unique per token. Nothing stores it yet; SCRUM-38 can use it to revoke
      // a single token without changing the token shape.
      { secret: readJwtSecrets(this.config).refresh, expiresIn: REFRESH_TOKEN_TTL_SECONDS, jwtid: randomUUID() },
    );
  }

  private invalidSession(): UnauthorizedException {
    return new UnauthorizedException('Invalid or expired session');
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
