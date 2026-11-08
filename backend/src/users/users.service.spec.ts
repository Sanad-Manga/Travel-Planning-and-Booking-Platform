import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const select = jest.fn();
  const exec = jest.fn();
  const query = { select, exec };
  const model = { findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    select.mockReturnValue(query);
    model.findOne.mockReturnValue(query);
    model.findById.mockReturnValue(query);
    model.findOneAndUpdate.mockReturnValue(query);
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: getModelToken(User.name), useValue: model }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('findByEmail normalizes the email and does not load the hash by default', async () => {
    exec.mockResolvedValue(null);
    await service.findByEmail('  Ali@Example.COM ');
    expect(model.findOne).toHaveBeenCalledWith({ email: 'ali@example.com' });
    expect(select).not.toHaveBeenCalled();
  });

  it('findByEmail loads the hash only when asked', async () => {
    exec.mockResolvedValue(null);
    await service.findByEmail('ali@example.com', true);
    expect(select).toHaveBeenCalledWith('+passwordHash');
  });

  it('findById queries by id', async () => {
    exec.mockResolvedValue(null);
    await service.findById('abc');
    expect(model.findById).toHaveBeenCalledWith('abc');
  });

  describe('isActive', () => {
    const lean = jest.fn();
    const ID = '674a1b2c3d4e5f6a7b8c9d0e';

    beforeEach(() => {
      select.mockReturnValue({ lean });
      lean.mockReturnValue(query);
    });

    it('reads only the status of that user', async () => {
      exec.mockResolvedValue({ status: 'ACTIVE' });
      await service.isActive(ID);
      expect(model.findById).toHaveBeenCalledWith(ID);
      expect(select).toHaveBeenCalledWith('status');
    });

    it('true for ACTIVE', async () => {
      exec.mockResolvedValue({ status: 'ACTIVE' });
      await expect(service.isActive(ID)).resolves.toBe(true);
    });

    it.each(['SUSPENDED', 'DEACTIVATED'])('false for %s', async (status) => {
      exec.mockResolvedValue({ status });
      await expect(service.isActive(ID)).resolves.toBe(false);
    });

    it('false when the user does not exist', async () => {
      exec.mockResolvedValue(null);
      await expect(service.isActive(ID)).resolves.toBe(false);
    });

    it('false for a malformed id, without querying the database', async () => {
      await expect(service.isActive('not-an-id')).resolves.toBe(false);
      expect(model.findById).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile (ACC-09)', () => {
    const ID = '674a1b2c3d4e5f6a7b8c9d0e';

    it('is ONE update, limited to ACTIVE users, returning the new document', async () => {
      exec.mockResolvedValue({ id: ID });
      await service.updateProfile(ID, { name: 'N', preferredCurrency: 'EUR' });
      expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, status: 'ACTIVE' },
        { $set: { name: 'N', preferredCurrency: 'EUR' } },
        { new: true },
      );
    });

    it('sets a non-empty phone', async () => {
      exec.mockResolvedValue(null);
      await service.updateProfile(ID, { phone: '+201001234567' });
      expect(model.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { phone: '+201001234567' } });
    });

    it('an empty phone is removed with $unset, not stored as an empty string', async () => {
      exec.mockResolvedValue(null);
      await service.updateProfile(ID, { name: 'N', phone: '' });
      expect(model.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { name: 'N' }, $unset: { phone: 1 } });
    });

    it('returns null when no ACTIVE user matched', async () => {
      exec.mockResolvedValue(null);
      await expect(service.updateProfile(ID, { name: 'N' })).resolves.toBeNull();
    });
  });

  it('create passes the input to the model', async () => {
    const input = { name: 'Ali', email: 'ali@example.com', passwordHash: 'h', consentAcceptedAt: new Date() };
    model.create.mockResolvedValue({ id: '1' });
    await expect(service.create(input)).resolves.toEqual({ id: '1' });
    expect(model.create).toHaveBeenCalledWith(input);
  });
});
