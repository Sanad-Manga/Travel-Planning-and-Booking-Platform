import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileChanges, UsersService } from './users.service';

/** ACC-09: reading and editing the logged-in user's own profile. Business rules live here, not in the controller. */
@Injectable()
export class ProfileService {
  constructor(
    private readonly usersService: UsersService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Authentication required');
    return UserResponseDto.from(user);
  }

  /**
   * All-or-nothing: every check (DTO shape, at least one field, supported currency) runs BEFORE the single
   * write, so one invalid field means nothing is saved. The user id comes from the token, never from the body.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserResponseDto> {
    const changes: ProfileChanges = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.phone !== undefined) changes.phone = dto.phone; // '' removes the phone number
    if (dto.preferredCurrency !== undefined) changes.preferredCurrency = dto.preferredCurrency;

    if (Object.keys(changes).length === 0) {
      throw this.fieldError('body', 'send at least one of name, phone, preferredCurrency');
    }

    // A DTO cannot see the database, so the "supported currency" rule is checked here (reference data, GEN-12).
    if (changes.preferredCurrency !== undefined && !(await this.referenceData.findCurrencyById(changes.preferredCurrency))) {
      throw this.fieldError('preferredCurrency', 'preferredCurrency is not a supported currency');
    }

    const user = await this.usersService.updateProfile(userId, changes);
    if (!user) throw new UnauthorizedException('Authentication required'); // gone, or no longer ACTIVE
    return UserResponseDto.from(user);
  }

  // Same shape as DTO validation errors, so the frontend shows it next to the right input.
  private fieldError(field: string, message: string): BadRequestException {
    return new BadRequestException({ message: 'Validation failed', details: [{ field, message }] });
  }
}
