import { ConflictException, Injectable } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';

// bcrypt work factor: each +1 doubles the hashing time. 10 is the common default (~50-100 ms).
export const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

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

  // Same shape as the validation errors so the frontend can show it next to the email field.
  private duplicateEmail(): ConflictException {
    return new ConflictException({
      message: 'Email already registered',
      details: [{ field: 'email', message: 'email already exists' }],
    });
  }
}
