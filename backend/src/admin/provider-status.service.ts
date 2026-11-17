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
import { Model, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, NotificationType, Role } from '../common';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/schemas/user.schema';
import {
  PROVIDER_TYPES,
  ProviderStatusResponseDto,
  ProviderType,
} from './dto/provider-status.dto';

/** Hotel and Airline both carry `name` and `isActive`, which is all this service touches. */
type ProviderModel = Model<{ name: string; isActive: boolean }>;

/**
 * ACC-15: an admin deactivates / reactivates a hotel or an airline. This only flips `isActive`; it never reads
 * or writes a booking, so existing CONFIRMED bookings stay valid, and it never changes a moderator's account
 * status (that is the separate ACC-16/ACC-15 suspend route).
 */
@Injectable()
export class ProviderStatusService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  deactivate(
    actor: AuthenticatedUser,
    type: string,
    id: string,
  ): Promise<ProviderStatusResponseDto> {
    return this.change(actor, type, id, false);
  }

  reactivate(
    actor: AuthenticatedUser,
    type: string,
    id: string,
  ): Promise<ProviderStatusResponseDto> {
    return this.change(actor, type, id, true);
  }

  private async change(
    actor: AuthenticatedUser,
    type: string,
    id: string,
    to: boolean,
  ): Promise<ProviderStatusResponseDto> {
    if (!actor?.userId)
      throw new UnauthorizedException('Authentication required');
    if (actor.role !== Role.ADMIN)
      throw new ForbiddenException('Administrator role required');
    if (!PROVIDER_TYPES.includes(type as ProviderType))
      throw new BadRequestException('Provider type must be hotel or airline');
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))
      throw new BadRequestException('Invalid provider identifier');
    const kind = type as ProviderType;
    const model: ProviderModel = (kind === 'hotel'
      ? this.hotels
      : this.airlines) as unknown as ProviderModel;
    const from = !to;

    // ONE conditional update: only a provider that is currently in the source state flips, so a double call or
    // a race changes it exactly once.
    let updated: { _id: { toString(): string }; name: string } | null;
    let exists = false;
    try {
      updated = await model
        .findOneAndUpdate(
          { _id: id, isActive: from },
          { $set: { isActive: to } },
          { new: true, projection: { _id: 1, name: 1 } },
        )
        .lean();
      if (!updated) exists = !!(await model.exists({ _id: id }));
    } catch {
      throw new InternalServerErrorException(
        'Provider status could not be changed',
      );
    }
    if (!updated) {
      if (!exists) throw new NotFoundException('Provider not found');
      throw new ConflictException(
        to ? 'Provider is already active' : 'Provider is already deactivated',
      );
    }
    const providerId = updated._id.toString();

    const linkField = kind === 'hotel' ? 'hotelId' : 'airlineId';
    let moderatorIds: string[] = [];
    try {
      moderatorIds = (
        await this.users
          .find({
            // users.airlineId / hotelId are Mixed in the User schema (no casting): match the ObjectId ACC-13 stores, and a string.
            [linkField]: { $in: [new Types.ObjectId(providerId), providerId] },
            role:
              kind === 'hotel' ? Role.HOTEL_MODERATOR : Role.AIRLINE_MODERATOR,
          })
          .select('_id')
          .lean()
      ).map((moderator) => moderator._id.toString());
    } catch {
      // Notification targets are best-effort, like the notification itself; the change and the audit still go ahead.
      moderatorIds = [];
    }

    try {
      await this.audit.log({
        actorId: actor.userId,
        action: to ? 'PROVIDER_REACTIVATED' : 'PROVIDER_DEACTIVATED',
        targetType: kind === 'hotel' ? 'Hotel' : 'Airline',
        targetId: providerId,
        details: {
          before: { isActive: from },
          after: { isActive: to },
          moderatorsNotified: to ? 0 : moderatorIds.length,
        },
      });
    } catch {
      // No audit entry means the change must not stand: put the flag back (conditionally) and say so.
      try {
        await model.findOneAndUpdate(
          { _id: providerId, isActive: to },
          { $set: { isActive: from } },
        );
      } catch {
        throw new InternalServerErrorException(
          'Provider status changed, but audit logging failed and the change could not be reverted',
        );
      }
      throw new InternalServerErrorException(
        'Provider status was not changed because audit logging failed',
      );
    }

    // There is no provider-reactivated NotificationType (common/ is not ours to extend): reactivation is audit-only.
    if (!to) {
      const label = kind === 'hotel' ? 'hotel' : 'airline';
      for (const userId of moderatorIds)
        // notify() never throws: a failed notification is logged and must not undo the deactivation.
        await this.notifications.notify({
          userId,
          type: NotificationType.PROVIDER_DEACTIVATED,
          title: `Your ${label} was deactivated`,
          message: `${updated.name} has been deactivated by an administrator. It is hidden from search and cannot receive new bookings. Existing confirmed bookings stay valid.`,
        });
    }
    return { id: providerId, type: kind, isActive: to };
  }
}
