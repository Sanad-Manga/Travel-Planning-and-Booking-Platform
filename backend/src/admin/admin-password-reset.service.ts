import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AccountStatus, AuthenticatedUser, Role } from '../common';
import { User } from '../users/schemas/user.schema';
import { AdminPasswordResetResponseDto } from './dto/admin-password-reset-response.dto';
import { PasswordResetTargetService } from './password-reset-target.service';
import { TemporaryPasswordService } from './temporary-password.service';

@Injectable()
export class AdminPasswordResetService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly targets: PasswordResetTargetService,
    private readonly passwords: TemporaryPasswordService,
    private readonly audit: AuditService,
  ) {}

  async reset(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<AdminPasswordResetResponseDto> {
    const eligible = await this.targets.getEligibleTarget(actor, id);
    id = eligible.id;
    let version: number;
    try {
      const target = await this.users
        .findById(id)
        .select('tokenVersion')
        .lean();
      if (!target)
        throw new ConflictException('Account changed; retry the reset');
      version = target.tokenVersion ?? 0;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new InternalServerErrorException(
        'Reset target could not be verified',
      );
    }
    const generated = await this.passwords.generate();
    try {
      const result = await this.users.updateOne(
        {
          _id: id,
          role: {
            $in: [Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR],
          },
          status: AccountStatus.ACTIVE,
          tokenVersion: version === 0 ? { $in: [0, null] } : version,
        },
        {
          $set: {
            passwordHash: generated.passwordHash,
            mustChangePassword: true,
            temporaryPasswordExpiresAt: generated.expiresAt,
            temporaryPasswordConsumed: false,
            failedAttempts: 0,
          },
          $inc: { tokenVersion: 1 },
          $unset: { lockedUntil: 1 },
        },
      );
      if (result.modifiedCount !== 1)
        throw new ConflictException(
          'Account or credentials changed; retry the reset',
        );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // Never forward a driver exception containing the credential update document.
      throw new InternalServerErrorException(
        'Password reset could not be persisted; credentials may have changed',
      );
    }
    try {
      await this.audit.log({
        actorId: actor.userId,
        action: 'ADMIN_PASSWORD_RESET',
        targetType: 'USER',
        targetId: id,
      });
    } catch {
      // The credential write already happened. No unsafe rollback and no plaintext response on failure.
      throw new InternalServerErrorException(
        'Audit failed; credentials have changed. Request another administrator reset.',
      );
    }
    return {
      id,
      temporaryPassword: generated.temporaryPassword,
      expiresAt: generated.expiresAt.toISOString(),
    };
  }
}
