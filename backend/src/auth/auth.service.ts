import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash, hashSync } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { AccessTokenPayload, AccountStatus } from '../common';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';

// bcrypt work factor: each +1 doubles the hashing time. 10 is the common default (~50-100 ms).
export const BCRYPT_SALT_ROUNDS = 10;

export interface LoginResult {
  user: UserResponseDto;
  accessToken: string;
}

@Injectable()
export class AuthService {
  // A real bcrypt hash of a random string nobody knows. When the email does not exist we still run
  // bcrypt against it, so "unknown email" and "wrong password" take the same time (no timing leak).
  private readonly dummyHash = hashSync(randomBytes(16).toString('hex'), BCRYPT_SALT_ROUNDS);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
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

    return { user: UserResponseDto.from(user), accessToken: await this.signAccessToken(user) };
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

  // Identical for "no such email" and "wrong password".
  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid email or password');
  }

  // Same shape as the validation errors so the frontend can show it next to the email field.
  private duplicateEmail(): ConflictException {
    return new ConflictException({
      message: 'Email already registered',
      details: [{ field: 'email', message: 'email already exists' }],
    });
  }
}
