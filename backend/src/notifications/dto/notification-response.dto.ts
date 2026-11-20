import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '../../common';
import { NotificationLean } from '../schemas/notification.schema';

export class NotificationResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiProperty({
    enum: NotificationType,
    example: NotificationType.BOOKING_CONFIRMED,
  })
  type: NotificationType;

  @ApiProperty({ example: 'Booking confirmed' })
  title: string;

  @ApiProperty({ example: 'Your flight CAI to DXB is confirmed.' })
  message: string;

  @ApiPropertyOptional({
    example: '/bookings/flights/674a1b2c3d4e5f6a7b8c9d0f',
  })
  link?: string;

  @ApiProperty({ example: false })
  isRead: boolean;

  @ApiPropertyOptional({
    example: '2026-11-20T14:30:00.000Z',
    description: 'Set once the notification is read',
  })
  readAt?: string;

  @ApiProperty({ example: '2026-11-20T14:00:00.000Z' })
  createdAt: string;
}

/** Response DTO, never the raw document: `_id` becomes `id`, `userId` / `__v` / `updatedAt` are not exposed. */
export function toNotificationResponse(
  doc: NotificationLean,
): NotificationResponseDto {
  return {
    id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    ...(doc.link ? { link: doc.link } : {}),
    isRead: doc.isRead,
    ...(doc.readAt ? { readAt: doc.readAt.toISOString() } : {}),
    createdAt: doc.createdAt.toISOString(),
  };
}
