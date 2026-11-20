import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountStatus, Role } from '../common';
import { User } from '../users/schemas/user.schema';
import { PasswordResetTargetService } from './password-reset-target.service';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

describe('ACC-07a read-only administrator target eligibility', () => {
  let service: PasswordResetTargetService;
  const users = { findById: jest.fn() };
  const actor = { userId: new Types.ObjectId().toString(), role: Role.ADMIN };
  const id = new Types.ObjectId();
  const select = jest.fn();
  beforeEach(async () => {
    jest.resetAllMocks();
    select.mockReturnValue({
      lean: async () => ({
        _id: id,
        role: Role.USER,
        status: AccountStatus.ACTIVE,
        passwordHash: 'synthetic-not-exposed',
      }),
    });
    users.findById.mockReturnValue({ select });
    const module = await Test.createTestingModule({
      providers: [
        PasswordResetTargetService,
        { provide: getModelToken(User.name), useValue: users },
      ],
    }).compile();
    service = module.get(PasswordResetTargetService);
  });
  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'accepts an ACTIVE %s target without loading a password',
    async (role) => {
      select.mockReturnValueOnce({
        lean: async () => ({
          _id: id,
          role,
          status: AccountStatus.ACTIVE,
          passwordHash: 'synthetic-not-exposed',
        }),
      });
      expect(await service.getEligibleTarget(actor, id.toString())).toEqual({
        id: id.toString(),
        role,
        status: AccountStatus.ACTIVE,
      });
      expect(select).toHaveBeenCalledWith('_id role status');
    },
  );
  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'rejects %s callers before reading an account',
    async (role) => {
      await expect(
        service.getEligibleTarget({ ...actor, role }, id.toString()),
      ).rejects.toMatchObject({ status: 403 });
      expect(users.findById).not.toHaveBeenCalled();
    },
  );
  it('rejects missing authentication and invalid IDs before database access', async () => {
    await expect(
      service.getEligibleTarget(undefined as never, id.toString()),
    ).rejects.toMatchObject({ status: 401 });
    for (const value of ['', 'invalid', 'a'.repeat(25)])
      await expect(
        service.getEligibleTarget(actor, value),
      ).rejects.toMatchObject({ status: 400 });
    expect(users.findById).not.toHaveBeenCalled();
  });
  it('rejects missing accounts', async () => {
    select.mockReturnValueOnce({ lean: async () => null });
    await expect(
      service.getEligibleTarget(actor, id.toString()),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects ADMIN targets including the caller themselves', async () => {
    select.mockReturnValue({
      lean: async () => ({
        _id: id,
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
      }),
    });
    await expect(
      service.getEligibleTarget(actor, id.toString()),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.getEligibleTarget(actor, actor.userId),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED])(
    'rejects a %s target without changing its status',
    async (status) => {
      select.mockReturnValueOnce({
        lean: async () => ({ _id: id, role: Role.USER, status }),
      });
      await expect(
        service.getEligibleTarget(actor, id.toString()),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
  it('sanitizes database diagnostics', async () => {
    users.findById.mockImplementationOnce(() => {
      throw new Error('synthetic-private-driver-diagnostic');
    });
    await expect(
      service.getEligibleTarget(actor, id.toString()),
    ).rejects.toThrow('Reset target could not be verified');
  });
});
