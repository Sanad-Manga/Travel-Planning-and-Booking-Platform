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
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import {
  AccountStatus,
  AuthenticatedUser,
  NotificationType,
  Role,
} from '../common';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/schemas/user.schema';
import { AccountStatusResponseDto } from './dto/account-status.dto';
import { AccountStatusOperation } from './schemas/account-status-operation.schema';

/** ACC-16 only. Registered with the existing ACC-14 AdminModule. */
@Injectable()
export class AccountStatusService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @InjectModel(AccountStatusOperation.name)
    private readonly operations: Model<AccountStatusOperation>,
  ) {}

  suspend(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<AccountStatusResponseDto> {
    return this.transition(
      actor,
      id,
      AccountStatus.ACTIVE,
      AccountStatus.SUSPENDED,
    );
  }

  reactivate(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<AccountStatusResponseDto> {
    return this.transition(
      actor,
      id,
      AccountStatus.SUSPENDED,
      AccountStatus.ACTIVE,
    );
  }

  private async transition(
    actor: AuthenticatedUser,
    id: string,
    from: AccountStatus,
    to: AccountStatus,
  ): Promise<AccountStatusResponseDto> {
    if (!actor?.userId)
      throw new UnauthorizedException('Authentication required');
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Administrator role required');
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))
      throw new BadRequestException('Invalid account identifier');
    if (actor.userId.toLowerCase() === id.toLowerCase())
      throw new ConflictException(
        'Administrators cannot change their own account status',
      );
    let updated: { _id: { toString(): string }; status: AccountStatus } | null;
    let existing: { role: Role; status: AccountStatus } | null = null;
    try {
      updated = await this.users
        .findOneAndUpdate(
          { _id: id, role: Role.USER, status: from },
          { $set: { status: to } },
          { new: true, runValidators: true, projection: { _id: 1, status: 1 } },
        )
        .lean();
      if (!updated)
        existing = await this.users.findById(id).select('role status').lean();
    } catch {
      throw new InternalServerErrorException(
        'Account status could not be changed',
      );
    }
    if (!updated) {
      if (!existing) throw new NotFoundException('Account not found');
      if (existing.role !== Role.USER)
        throw new ConflictException(
          'Only registered USER accounts can be suspended or reactivated here',
        );
      if (existing.status !== to)
        throw new ConflictException(
          'Account is not in the required source status',
        );
    }
    const targetId = updated ? updated._id.toString() : id.toLowerCase();
    if (updated) {
      try {
        await this.operations.create({
          actorId: actor.userId,
          targetId,
          from,
          to,
        });
      } catch {
        throw new InternalServerErrorException(
          'Account status changed, but recovery metadata could not be stored',
        );
      }
    }
    // A no-op only replays recorded real transitions, with their ORIGINAL actor.
    // No journal means no historical action can safely be attributed to this caller.
    try {
      const pending = await this.operations
        .find({ targetId, complete: false })
        .sort({ _id: 1 })
        .lean();
      for (const operation of pending) await this.finishOperation(operation);
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new InternalServerErrorException(
        'Account status changed, but audit recovery is pending',
      );
    }
    return { id: targetId, status: to };
  }

  private async finishOperation(
    operation: AccountStatusOperation,
  ): Promise<void> {
    const leaseToken = randomUUID();
    const deadline = Date.now() + 5000;
    let claimed: AccountStatusOperation | null = null;
    do {
      claimed = await this.operations
        .findOneAndUpdate(
          {
            _id: operation._id,
            complete: false,
            $or: [
              { leaseUntil: { $exists: false } },
              { $expr: { $lte: ['$leaseUntil', '$$NOW'] } },
            ],
          },
          [
            {
              $set: {
                leaseToken: { $literal: leaseToken },
                leaseUntil: {
                  $dateAdd: {
                    startDate: '$$NOW',
                    unit: 'millisecond',
                    amount: 60000,
                  },
                },
                updatedAt: '$$NOW',
              },
            },
          ],
          { new: true, updatePipeline: true, timestamps: false },
        )
        .lean();
      if (claimed) break;
      const current = await this.operations.findById(operation._id).lean();
      if (current?.complete) return;
      if (Date.now() >= deadline)
        throw new InternalServerErrorException(
          'Account status changed, but audit recovery is still in progress',
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (!claimed);
    const owned = { _id: operation._id, leaseToken };
    try {
      if (!claimed.audited) {
        const hex = String(claimed._id);
        // Separate digit runs so an opaque identifier cannot resemble card data
        // to the shared audit details validator.
        const operationId = `status:${hex.slice(0, 8)}:${hex.slice(8, 16)}:${hex.slice(16)}`;
        const action =
          claimed.to === AccountStatus.SUSPENDED
            ? 'USER_SUSPENDED'
            : 'USER_REACTIVATED';
        // Correlation avoids an unnecessary duplicate after a lost acknowledgement.
        // The shared audit API has no unique idempotency key: see documented limits.
        const logged = await this.users.db
          .collection('auditLogs')
          .findOne(
            {
              'details.operationId': operationId,
              actorId: claimed.actorId,
              targetId: claimed.targetId,
              targetType: 'User',
              action,
            },
            { projection: { _id: 1 } },
          );
        try {
          if (!logged)
            await this.audit.log({
              actorId: claimed.actorId,
              action,
              targetType: 'User',
              targetId: claimed.targetId,
              details: {
                operationId,
                before: { status: claimed.from },
                after: { status: claimed.to },
              },
            });
        } catch {
          throw new InternalServerErrorException(
            'Account status changed, but audit logging failed',
          );
        }
        await this.operations.updateOne(owned, { $set: { audited: true } });
      }
      // Reserve the best-effort attempt BEFORE calling notify. Crashes may lose
      // delivery, but a completed operation never deliberately notifies twice.
      const notice = await this.operations
        .findOneAndUpdate(
          { ...owned, notificationAttempted: false },
          { $set: { notificationAttempted: true } },
          { new: true },
        )
        .lean();
      if (notice) {
        try {
          await this.notifications.notify({
            userId: claimed.targetId,
            type:
              claimed.to === AccountStatus.SUSPENDED
                ? NotificationType.ACCOUNT_SUSPENDED
                : NotificationType.ACCOUNT_REACTIVATED,
            title:
              claimed.to === AccountStatus.SUSPENDED
                ? 'Account suspended'
                : 'Account reactivated',
            message:
              claimed.to === AccountStatus.SUSPENDED
                ? 'Your account has been suspended. Existing bookings and content are unchanged.'
                : 'Your account has been reactivated and access has been restored.',
          });
        } catch {
          throw new InternalServerErrorException(
            'Account status changed, but notification delivery failed',
          );
        }
      }
      await this.operations.updateOne(owned, {
        $set: { complete: true },
        $unset: { leaseToken: 1, leaseUntil: 1 },
      });
    } catch (error) {
      // No status rollback. Keep original actor/transition for a later retry.
      try {
        await this.operations.updateOne(owned, {
          $unset: { leaseToken: 1, leaseUntil: 1 },
        });
      } catch {
        /* Expiring lease permits later recovery. */
      }
      throw error;
    }
  }
}
