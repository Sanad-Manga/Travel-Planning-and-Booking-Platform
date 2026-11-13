import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AccountStatus, NotificationType, Role } from '../common';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/schemas/user.schema';
import { AccountStatusService } from './account-status.service';
import { AccountStatusOperation } from './schemas/account-status-operation.schema';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
describe('ACC-16 status service guards, atomic filters and partial failures', () => {
  let service: AccountStatusService;
  const auditLookup = jest.fn();
  const users = {
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
    db: { collection: () => ({ findOne: auditLookup }) },
  };
  const operations = {
    create: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
    updateOne: jest.fn(),
  };
  let recorded: AccountStatusOperation | undefined;
  const audit = { log: jest.fn() };
  const notifications = { notify: jest.fn() };
  const actor = { userId: new Types.ObjectId().toString(), role: Role.ADMIN };
  const id = new Types.ObjectId().toString();
  beforeEach(async () => {
    jest.resetAllMocks();
    audit.log.mockResolvedValue(undefined);
    notifications.notify.mockResolvedValue(undefined);
    recorded = undefined;
    auditLookup.mockResolvedValue(null);
    operations.create.mockImplementation(async (input) => {
      recorded = {
        ...input,
        _id: new Types.ObjectId(),
        audited: false,
        notificationAttempted: false,
        complete: false,
      };
      return recorded;
    });
    operations.find.mockReturnValue({
      sort: () => ({
        lean: async () => (recorded && !recorded.complete ? [recorded] : []),
      }),
    });
    operations.findOneAndUpdate.mockImplementation((filter, update) => ({
      lean: async () => {
        if (
          !recorded ||
          (filter.notificationAttempted === false &&
            recorded.notificationAttempted)
        )
          return null;
        const values = Array.isArray(update) ? update[0].$set : update.$set;
        Object.assign(recorded, values);
        if (values.leaseToken?.$literal)
          recorded.leaseToken = values.leaseToken.$literal;
        return { ...recorded };
      },
    }));
    operations.updateOne.mockImplementation(async (_filter, update) => {
      Object.assign(recorded!, update.$set);
      return { modifiedCount: 1 };
    });
    operations.findById.mockReturnValue({ lean: async () => recorded });
    users.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(id),
        status: AccountStatus.SUSPENDED,
      }),
    });
    users.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: Role.USER }),
      }),
    });
    const module = await Test.createTestingModule({
      providers: [
        AccountStatusService,
        { provide: getModelToken(User.name), useValue: users },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: getModelToken(AccountStatusOperation.name),
          useValue: operations,
        },
      ],
    }).compile();
    service = module.get(AccountStatusService);
  });
  it.each(['suspend', 'reactivate'] as const)(
    'uses one conditional %s update and maps no private fields',
    async (method) => {
      const from =
        method === 'suspend' ? AccountStatus.ACTIVE : AccountStatus.SUSPENDED;
      const to =
        method === 'suspend' ? AccountStatus.SUSPENDED : AccountStatus.ACTIVE;
      users.findOneAndUpdate.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(id),
          status: to,
          passwordHash: 'synthetic',
        }),
      });
      expect(await service[method](actor, id)).toEqual({ id, status: to });
      expect(users.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, role: Role.USER, status: from },
        { $set: { status: to } },
        { new: true, runValidators: true, projection: { _id: 1, status: 1 } },
      );
      expect(users.findById).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith({
        actorId: actor.userId,
        action: method === 'suspend' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
        targetType: 'User',
        targetId: id,
        details: {
          operationId: `status:${String(recorded!._id).slice(0, 8)}:${String(recorded!._id).slice(8, 16)}:${String(recorded!._id).slice(16)}`,
          before: { status: from },
          after: { status: to },
        },
      });
      if (method === 'suspend')
        expect(notifications.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: id,
            type: NotificationType.ACCOUNT_SUSPENDED,
          }),
        );
      else
        expect(notifications.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: id,
            type: NotificationType.ACCOUNT_REACTIVATED,
          }),
        );
    },
  );
  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'denies %s before touching the database',
    async (role) => {
      for (const method of ['suspend', 'reactivate'] as const)
        await expect(
          service[method]({ ...actor, role }, id),
        ).rejects.toMatchObject({ status: 403 });
      expect(users.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );
  it('rejects missing principals and malformed IDs before mutation', async () => {
    await expect(service.suspend(undefined as never, id)).rejects.toMatchObject(
      { status: 401 },
    );
    for (const value of ['invalid', '', 'a'.repeat(25)])
      await expect(service.suspend(actor, value)).rejects.toMatchObject({
        status: 400,
      });
    expect(users.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { role: Role.USER },
    { role: Role.ADMIN },
    { role: Role.AIRLINE_MODERATOR },
    { role: Role.HOTEL_MODERATOR },
  ])(
    'classifies unsuccessful updates without side effects %#',
    async (existing) => {
      users.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      users.findById.mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({ lean: jest.fn().mockResolvedValue(existing) }),
      });
      await expect(service.suspend(actor, id)).rejects.toMatchObject({
        status: existing ? 409 : 404,
      });
      expect(audit.log).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    },
  );
  it('sanitizes database failures and performs no side effects', async () => {
    users.findOneAndUpdate.mockImplementationOnce(() => {
      throw new Error('synthetic-private-driver-error');
    });
    await expect(service.suspend(actor, id)).rejects.toThrow(
      'Account status could not be changed',
    );
    expect(audit.log).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
  it('reports failed auditing after the change, skips notification and never rolls back', async () => {
    audit.log.mockRejectedValueOnce(new Error('synthetic-private-audit-error'));
    await expect(service.suspend(actor, id)).rejects.toThrow(
      'Account status changed, but audit logging failed',
    );
    expect(users.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
  it('awaits the audit before notifying or resolving', async () => {
    let finish!: () => void;
    audit.log.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const result = service.suspend(actor, id);
    while (!audit.log.mock.calls.length)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifications.notify).not.toHaveBeenCalled();
    finish();
    await result;
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });
  it.each(['suspend', 'reactivate'] as const)(
    'returns a no-op for an existing target status on %s without inventing historical side effects',
    async (method) => {
      const status =
        method === 'suspend' ? AccountStatus.SUSPENDED : AccountStatus.ACTIVE;
      users.findOneAndUpdate.mockReturnValueOnce({ lean: async () => null });
      users.findById.mockReturnValueOnce({
        select: () => ({ lean: async () => ({ role: Role.USER, status }) }),
      });
      expect(await service[method](actor, id)).toEqual({ id, status });
      expect(operations.create).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    },
  );
  it('rejects the administrator as their own target without mutation', async () => {
    users.findOneAndUpdate.mockReturnValueOnce({ lean: async () => null });
    users.findById.mockReturnValueOnce({
      select: () => ({
        lean: async () => ({ role: Role.ADMIN, status: AccountStatus.ACTIVE }),
      }),
    });
    await expect(service.suspend(actor, actor.userId)).rejects.toMatchObject({
      status: 409,
    });
    expect(users.findOneAndUpdate).not.toHaveBeenCalled();
    expect(operations.create).not.toHaveBeenCalled();
  });
  it('reports unexpected notification rejection without undoing the audited transition', async () => {
    notifications.notify.mockRejectedValueOnce(
      new Error('synthetic-private-notification-error'),
    );
    await expect(service.suspend(actor, id)).rejects.toThrow(
      'Account status changed, but notification delivery failed',
    );
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(users.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
