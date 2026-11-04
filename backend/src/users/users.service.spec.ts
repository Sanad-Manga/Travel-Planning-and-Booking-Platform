import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const select = jest.fn();
  const exec = jest.fn();
  const query = { select, exec };
  const model = { findOne: jest.fn(), findById: jest.fn(), create: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    select.mockReturnValue(query);
    model.findOne.mockReturnValue(query);
    model.findById.mockReturnValue(query);
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

  it('create passes the input to the model', async () => {
    const input = { name: 'Ali', email: 'ali@example.com', passwordHash: 'h', consentAcceptedAt: new Date() };
    model.create.mockResolvedValue({ id: '1' });
    await expect(service.create(input)).resolves.toEqual({ id: '1' });
    expect(model.create).toHaveBeenCalledWith(input);
  });
});
