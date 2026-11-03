import {
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser, NotificationType, Role } from '../common';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationLean } from './schemas/notification.schema';

const USER_ID = new Types.ObjectId().toString();
const user: AuthenticatedUser = { userId: USER_ID, role: Role.USER };

/** A Mongoose query stand-in: every builder method returns itself and exec() resolves `result`. */
function query(result: unknown) {
  const q: Record<string, jest.Mock> = {};
  for (const method of ['sort', 'skip', 'limit', 'lean', 'populate'])
    q[method] = jest.fn(() => q);
  q.exec = jest.fn().mockResolvedValue(result);
  return q;
}

function lean(overrides: Partial<NotificationLean> = {}): NotificationLean {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(USER_ID),
    type: NotificationType.BOOKING_CONFIRMED,
    title: 'Booking confirmed',
    message: 'Your flight is confirmed.',
    isRead: false,
    createdAt: new Date('2026-11-20T14:00:00.000Z'),
    updatedAt: new Date('2026-11-20T14:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  const model = {
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  let service: NotificationsService;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    service = new NotificationsService(model as unknown as Model<Notification>);
  });

  afterEach(() => {
    errorLog.mockRestore();
  });

  describe('notify', () => {
    it('saves an unread notification for the user', async () => {
      model.create.mockResolvedValue({});

      await service.notify({
        userId: USER_ID,
        type: NotificationType.REFUND_UPDATE,
        title: 'Refund issued',
        message: 'We refunded your booking.',
        link: '/bookings/1',
      });

      expect(model.create).toHaveBeenCalledTimes(1);
      const saved = model.create.mock.calls[0][0];
      expect(saved.userId).toBeInstanceOf(Types.ObjectId);
      expect(saved.userId.toString()).toBe(USER_ID);
      expect(saved).toMatchObject({
        type: NotificationType.REFUND_UPDATE,
        title: 'Refund issued',
        message: 'We refunded your booking.',
        link: '/bookings/1',
      });
    });

    it('leaves the link out when none is given', async () => {
      model.create.mockResolvedValue({});
      await service.notify({
        userId: USER_ID,
        type: NotificationType.BOOKING_CANCELLED,
        title: 't',
        message: 'm',
      });
      expect(model.create.mock.calls[0][0]).not.toHaveProperty('link');
    });

    it('never throws when saving fails, it logs instead', async () => {
      model.create.mockRejectedValue(new Error('database down'));

      await expect(
        service.notify({
          userId: USER_ID,
          type: NotificationType.BOOKING_CONFIRMED,
          title: 't',
          message: 'm',
        }),
      ).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('never throws and saves nothing for an invalid user id', async () => {
      await expect(
        service.notify({
          userId: 'nope',
          type: NotificationType.BOOKING_CONFIRMED,
          title: 't',
          message: 'm',
        }),
      ).resolves.toBeUndefined();
      expect(model.create).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    it("returns only the caller's notifications, newest first, as response DTOs in the pagination envelope", async () => {
      const row = lean({
        link: '/x',
        isRead: true,
        readAt: new Date('2026-11-21T09:00:00.000Z'),
      });
      const find = query([row]);
      model.find.mockReturnValue(find);
      model.countDocuments.mockReturnValue(query(25));

      const page = await service.list(user, { page: 2, limit: 10 });

      const filter = model.find.mock.calls[0][0];
      expect((filter.userId as Types.ObjectId).equals(USER_ID)).toBe(true);
      expect(filter).not.toHaveProperty('isRead');
      expect(find.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(find.skip).toHaveBeenCalledWith(10);
      expect(find.limit).toHaveBeenCalledWith(10);

      expect(page).toMatchObject({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
      expect(page.items).toEqual([
        {
          id: row._id.toString(),
          type: NotificationType.BOOKING_CONFIRMED,
          title: 'Booking confirmed',
          message: 'Your flight is confirmed.',
          link: '/x',
          isRead: true,
          readAt: '2026-11-21T09:00:00.000Z',
          createdAt: '2026-11-20T14:00:00.000Z',
        },
      ]);
    });

    it('never exposes the raw document fields', async () => {
      model.find.mockReturnValue(query([lean()]));
      model.countDocuments.mockReturnValue(query(1));

      const [item] = (await service.list(user, { page: 1, limit: 10 })).items;

      for (const hidden of ['_id', 'userId', '__v', 'updatedAt'])
        expect(item).not.toHaveProperty(hidden);
      expect(item).not.toHaveProperty('link');
      expect(item).not.toHaveProperty('readAt');
    });

    it.each([true, false])(
      'adds isRead=%s to the filter only when asked',
      async (isRead) => {
        model.find.mockReturnValue(query([]));
        model.countDocuments.mockReturnValue(query(0));

        await service.list(user, { page: 1, limit: 10, isRead });

        expect(model.find.mock.calls[0][0].isRead).toBe(isRead);
        expect(model.countDocuments.mock.calls[0][0].isRead).toBe(isRead);
      },
    );

    it('answers 401 when the session carries an invalid user id', () => {
      expect(() =>
        service.list({ ...user, userId: 'bad' }, { page: 1, limit: 10 }),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('unreadCount', () => {
    it("counts only the caller's unread notifications", async () => {
      model.countDocuments.mockReturnValue(query(4));

      await expect(service.unreadCount(user)).resolves.toEqual({
        unreadCount: 4,
      });

      const filter = model.countDocuments.mock.calls[0][0];
      expect((filter.userId as Types.ObjectId).equals(USER_ID)).toBe(true);
      expect(filter.isRead).toBe(false);
    });
  });

  describe('markRead', () => {
    const id = new Types.ObjectId().toString();

    it('flips an unread notification of the caller with one atomic update', async () => {
      const updated = lean({
        isRead: true,
        readAt: new Date('2026-11-21T09:00:00.000Z'),
      });
      model.findOneAndUpdate.mockReturnValue(query(updated));

      const result = await service.markRead(user, id);

      const [filter, update, options] = model.findOneAndUpdate.mock.calls[0];
      expect(filter._id).toBe(id);
      expect((filter.userId as Types.ObjectId).equals(USER_ID)).toBe(true);
      expect(filter.isRead).toBe(false);
      expect(update.$set.isRead).toBe(true);
      expect(update.$set.readAt).toBeInstanceOf(Date);
      expect(options).toEqual({ new: true });
      expect(result).toMatchObject({
        id: updated._id.toString(),
        isRead: true,
        readAt: '2026-11-21T09:00:00.000Z',
      });
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('returns an already-read notification unchanged instead of failing', async () => {
      const alreadyRead = lean({
        isRead: true,
        readAt: new Date('2026-11-20T15:00:00.000Z'),
      });
      model.findOneAndUpdate.mockReturnValue(query(null));
      model.findOne.mockReturnValue(query(alreadyRead));

      const result = await service.markRead(user, id);

      expect(result).toMatchObject({
        isRead: true,
        readAt: '2026-11-20T15:00:00.000Z',
      });
      const lookup = model.findOne.mock.calls[0][0];
      expect((lookup.userId as Types.ObjectId).equals(USER_ID)).toBe(true);
    });

    it('answers 404 for a missing notification or one that belongs to someone else', async () => {
      model.findOneAndUpdate.mockReturnValue(query(null));
      model.findOne.mockReturnValue(query(null));

      await expect(service.markRead(user, id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('answers 401 when the session carries an invalid user id', async () => {
      await expect(
        service.markRead({ ...user, userId: 'bad' }, id),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
