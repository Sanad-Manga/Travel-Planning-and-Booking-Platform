import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AuthenticatedUser,
  NotificationType,
  paginate,
  PaginatedResponse,
} from '../common';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import {
  NotificationResponseDto,
  toNotificationResponse,
} from './dto/notification-response.dto';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { Notification, NotificationLean } from './schemas/notification.schema';

/** The input of `notify`, exactly as published in docs/contracts.md section 7. */
export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly model: Model<Notification>,
  ) {}

  /**
   * Called by every module that tells a user something. It never throws: telling the user is secondary,
   * so a failure here (bad id, database hiccup) is logged and must not break the booking, refund
   * or suspension that triggered it.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(input.userId))
        throw new Error('userId is not a valid id');
      await this.model.create({
        userId: new Types.ObjectId(input.userId),
        type: input.type,
        title: input.title,
        message: input.message,
        ...(input.link ? { link: input.link } : {}),
      });
    } catch (error) {
      this.logger.error(
        `Could not save ${input.type} notification for user ${input.userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** The caller's own notifications, newest first. Only ever filters by the caller's id. */
  list(
    user: AuthenticatedUser,
    query: ListNotificationsDto,
  ): Promise<PaginatedResponse<NotificationResponseDto>> {
    const filter: FilterQuery<Notification> = {
      userId: this.toObjectId(user.userId),
    };
    if (query.isRead !== undefined) filter.isRead = query.isRead;

    return paginate(this.model, filter, query, {
      map: toNotificationResponse,
      sort: { createdAt: -1, _id: -1 },
    });
  }

  async unreadCount(user: AuthenticatedUser): Promise<UnreadCountResponseDto> {
    const unreadCount = await this.model
      .countDocuments({ userId: this.toObjectId(user.userId), isRead: false })
      .exec();
    return { unreadCount };
  }

  /**
   * Mark one of the caller's notifications as read. Marking an already-read one is fine (it is returned as is).
   * Someone else's notification and a missing one both answer 404, so ids cannot be probed.
   */
  async markRead(
    user: AuthenticatedUser,
    id: string,
  ): Promise<NotificationResponseDto> {
    const userId = this.toObjectId(user.userId);

    // One atomic update: only flips an unread notification that belongs to this user.
    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, userId, isRead: false },
        { $set: { isRead: true, readAt: new Date() } },
        { new: true },
      )
      .lean<NotificationLean>()
      .exec();
    if (updated) return toNotificationResponse(updated);

    const existing = await this.model
      .findOne({ _id: id, userId })
      .lean<NotificationLean>()
      .exec();
    if (!existing) throw new NotFoundException('Notification not found');
    return toNotificationResponse(existing);
  }

  private toObjectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id))
      throw new UnauthorizedException('Invalid session');
    return new Types.ObjectId(id);
  }
}
