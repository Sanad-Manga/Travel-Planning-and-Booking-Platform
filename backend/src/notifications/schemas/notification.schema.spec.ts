import mongoose from 'mongoose';
import { NotificationType } from '../../common';
import { NotificationSchema } from './notification.schema';

// Validation and defaults are checked in memory: no database connection is needed for that.
const NotificationModel = mongoose.model(
  'NotificationSchemaSpec',
  NotificationSchema,
);

const valid = () => ({
  userId: new mongoose.Types.ObjectId(),
  type: NotificationType.ACCOUNT_SUSPENDED,
  title: 'Account suspended',
  message: 'Your account was suspended.',
});

describe('Notification schema', () => {
  it('accepts the ACC-16 reactivation type approved by the Scrum Master', () => {
    expect(NotificationType.ACCOUNT_REACTIVATED).toBe('ACCOUNT_REACTIVATED');
    expect(
      new NotificationModel({
        ...valid(),
        type: NotificationType.ACCOUNT_REACTIVATED,
      }).validateSync(),
    ).toBeUndefined();
  });
  it('accepts a complete notification and starts it unread', () => {
    const doc = new NotificationModel(valid());
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.isRead).toBe(false);
    expect(doc.readAt).toBeUndefined();
  });

  it.each(Object.values(NotificationType))('accepts the %s type', (type) => {
    expect(
      new NotificationModel({ ...valid(), type }).validateSync(),
    ).toBeUndefined();
  });

  it('rejects an unknown type', () => {
    const error = new NotificationModel({
      ...valid(),
      type: 'SOMETHING_ELSE',
    }).validateSync();
    expect(error?.errors.type).toBeDefined();
  });

  it.each(['userId', 'type', 'title', 'message'])('requires %s', (field) => {
    const input: Record<string, unknown> = valid();
    delete input[field];
    expect(
      new NotificationModel(input).validateSync()?.errors[field],
    ).toBeDefined();
  });

  it('indexes the lookups the endpoints use', () => {
    const indexed = NotificationSchema.indexes().map(([fields]) => fields);
    expect(indexed).toContainEqual({ userId: 1, createdAt: -1 });
    expect(indexed).toContainEqual({ userId: 1, isRead: 1, createdAt: -1 });
  });
});
