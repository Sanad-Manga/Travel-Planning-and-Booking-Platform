import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountStatus, AuthenticatedUser, Role } from '../common';
import { User } from '../users/schemas/user.schema';

/**
 * Read-only eligibility check for an administrator-assisted reset: the target must exist and be an ACTIVE
 * regular user or moderator. It changes nothing. AdminPasswordResetService repeats the role, status and
 * token-version conditions inside its own atomic update, so a change between the two steps is a 409.
 */
@Injectable()
export class PasswordResetTargetService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async getEligibleTarget(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<{ id: string; role: Role; status: AccountStatus }> {
    if (!actor?.userId)
      throw new UnauthorizedException('Authentication required');
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Administrator role required');
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))
      throw new BadRequestException('Invalid account identifier');
    let target;
    try {
      target = await this.users.findById(id).select('_id role status').lean();
    } catch {
      throw new InternalServerErrorException(
        'Reset target could not be verified',
      );
    }
    if (!target) throw new NotFoundException('Account not found');
    if (
      ![Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR].includes(
        target.role,
      )
    )
      throw new ConflictException(
        'Only regular users and moderators can receive this reset',
      );
    if (target.status !== AccountStatus.ACTIVE)
      throw new ConflictException(
        'Only ACTIVE accounts can receive an administrative password reset',
      );
    return {
      id: target._id.toString(),
      role: target.role,
      status: target.status,
    };
  }
}
