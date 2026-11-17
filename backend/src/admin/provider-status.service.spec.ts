import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { AuditService } from '../audit/audit.service';
import { NotificationType, Role } from '../common';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/schemas/user.schema';
import { ProviderStatusService } from './provider-status.service';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

const leanOf = (value: unknown) => ({
  lean: jest.fn().mockResolvedValue(value),
});

describe('ACC-15 provider status service (test doubles: no database)', () => {
  let service: ProviderStatusService;
  const hotels = { findOneAndUpdate: jest.fn(), exists: jest.fn() };
  const airlines = { findOneAndUpdate: jest.fn(), exists: jest.fn() };
  const find = jest.fn();
  const users = { find };
  const audit = { log: jest.fn() };
  const notifications = { notify: jest.fn() };
  const actor = { userId: new Types.ObjectId().toString(), role: Role.ADMIN };
  const id = new Types.ObjectId().toString();
  const moderatorA = new Types.ObjectId();
  const moderatorB = new Types.ObjectId();

  beforeEach(async () => {
    jest.resetAllMocks();
    audit.log.mockResolvedValue(undefined);
    notifications.notify.mockResolvedValue(undefined);
    hotels.findOneAndUpdate.mockReturnValue(
      leanOf({ _id: new Types.ObjectId(id), name: 'Alpha' }),
    );
    airlines.findOneAndUpdate.mockReturnValue(
      leanOf({ _id: new Types.ObjectId(id), name: 'Air A' }),
    );
    find.mockReturnValue({
      select: () => leanOf([{ _id: moderatorA }, { _id: moderatorB }]),
    });
    const module = await Test.createTestingModule({
      providers: [
        ProviderStatusService,
        { provide: getModelToken(Hotel.name), useValue: hotels },
        { provide: getModelToken(Airline.name), useValue: airlines },
        { provide: getModelToken(User.name), useValue: users },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(ProviderStatusService);
  });

  it.each([
    ['hotel', hotels, 'hotelId', Role.HOTEL_MODERATOR, 'Hotel'],
    ['airline', airlines, 'airlineId', Role.AIRLINE_MODERATOR, 'Airline'],
  ] as const)(
    'deactivates a %s with one conditional update, audits it and notifies only its linked moderators',
    async (type, model, linkField, role, targetType) => {
      expect(await service.deactivate(actor, type, id)).toEqual({
        id,
        type,
        isActive: false,
      });
      expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, isActive: true },
        { $set: { isActive: false } },
        { new: true, projection: { _id: 1, name: 1 } },
      );
      expect(find).toHaveBeenCalledWith({
        [linkField]: { $in: [new Types.ObjectId(id), id] },
        role,
      });
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith({
        actorId: actor.userId,
        action: 'PROVIDER_DEACTIVATED',
        targetType,
        targetId: id,
        details: {
          before: { isActive: true },
          after: { isActive: false },
          moderatorsNotified: 2,
        },
      });
      expect(notifications.notify).toHaveBeenCalledTimes(2);
      for (const moderator of [moderatorA, moderatorB])
        expect(notifications.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: moderator.toString(),
            type: NotificationType.PROVIDER_DEACTIVATED,
          }),
        );
    },
  );

  it('reactivates with the opposite conditional update, audits it and sends no notification', async () => {
    expect(await service.reactivate(actor, 'hotel', id)).toEqual({
      id,
      type: 'hotel',
      isActive: true,
    });
    expect(hotels.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, isActive: false },
      { $set: { isActive: true } },
      expect.any(Object),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROVIDER_REACTIVATED' }),
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('succeeds when the provider has no moderators', async () => {
    find.mockReturnValue({ select: () => leanOf([]) });
    await expect(
      service.deactivate(actor, 'airline', id),
    ).resolves.toMatchObject({ isActive: false });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('is 404 for an unknown provider and 409 when it is already in the requested state, with no side effects', async () => {
    hotels.findOneAndUpdate.mockReturnValue(leanOf(null));
    hotels.exists.mockResolvedValueOnce(null);
    await expect(service.deactivate(actor, 'hotel', id)).rejects.toMatchObject({
      status: 404,
    });
    hotels.exists.mockResolvedValueOnce({ _id: id });
    await expect(service.deactivate(actor, 'hotel', id)).rejects.toMatchObject({
      status: 409,
      message: 'Provider is already deactivated',
    });
    hotels.exists.mockResolvedValueOnce({ _id: id });
    await expect(service.reactivate(actor, 'hotel', id)).rejects.toMatchObject({
      status: 409,
      message: 'Provider is already active',
    });
    expect(audit.log).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('checks the caller and the input before touching the database', async () => {
    await expect(
      service.deactivate(undefined as never, 'hotel', id),
    ).rejects.toMatchObject({ status: 401 });
    for (const role of [
      Role.USER,
      Role.AIRLINE_MODERATOR,
      Role.HOTEL_MODERATOR,
    ])
      await expect(
        service.deactivate({ ...actor, role }, 'hotel', id),
      ).rejects.toMatchObject({ status: 403 });
    await expect(service.deactivate(actor, 'flight', id)).rejects.toMatchObject(
      { status: 400 },
    );
    await expect(
      service.deactivate(actor, 'hotel', 'not-an-id'),
    ).rejects.toMatchObject({ status: 400 });
    expect(hotels.findOneAndUpdate).not.toHaveBeenCalled();
    expect(airlines.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('sanitizes a database failure on the update', async () => {
    hotels.findOneAndUpdate.mockImplementation(() => {
      throw new Error('synthetic-private-driver-error');
    });
    await expect(service.deactivate(actor, 'hotel', id)).rejects.toThrow(
      'Provider status could not be changed',
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('reverts the flag when the audit write fails, and sends no notification', async () => {
    audit.log.mockRejectedValue(new Error('audit down'));
    hotels.findOneAndUpdate
      .mockReturnValueOnce(
        leanOf({ _id: new Types.ObjectId(id), name: 'Alpha' }),
      )
      .mockResolvedValueOnce(null);
    await expect(service.deactivate(actor, 'hotel', id)).rejects.toMatchObject({
      status: 500,
      message: 'Provider status was not changed because audit logging failed',
    });
    expect(hotels.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: id, isActive: false },
      { $set: { isActive: true } },
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('says so when the audit write fails and the revert fails too', async () => {
    audit.log.mockRejectedValue(new Error('audit down'));
    hotels.findOneAndUpdate
      .mockReturnValueOnce(
        leanOf({ _id: new Types.ObjectId(id), name: 'Alpha' }),
      )
      .mockRejectedValueOnce(new Error('db down'));
    await expect(service.deactivate(actor, 'hotel', id)).rejects.toThrow(
      'could not be reverted',
    );
  });

  it('still deactivates and audits when the moderator lookup fails', async () => {
    find.mockImplementation(() => {
      throw new Error('lookup down');
    });
    await expect(service.deactivate(actor, 'hotel', id)).resolves.toMatchObject(
      { isActive: false },
    );
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
