import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountStatus, Role } from '../common';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

describe('ACC-14 AdminService authorization, safe query construction and projection', () => {
  let service: AdminService;
  const model = { find: jest.fn(), countDocuments: jest.fn() };
  const admin = { userId: 'fixture-admin', role: Role.ADMIN };
  const row = {
    _id: new Types.ObjectId(),
    name: 'Fixture',
    email: 'fixture@example.test',
    role: Role.USER,
    status: AccountStatus.ACTIVE,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    passwordHash: 'synthetic-must-not-appear',
    failedAttempts: 4,
    consentAcceptedAt: new Date(),
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([row]),
    };
    model.find.mockReturnValue(query);
    model.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: model },
      ],
    }).compile();
    service = module.get(AdminService);
  });
  it.each([Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'denies direct %s callers before any query',
    async (role) => {
      await expect(
        service.listAccounts(
          { userId: 'fixture', role },
          new ListAccountsQueryDto(),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(model.find).not.toHaveBeenCalled();
    },
  );
  it('denies a missing authenticated principal before querying', async () => {
    await expect(
      service.listAccounts(undefined as never, new ListAccountsQueryDto()),
    ).rejects.toMatchObject({ status: 401 });
    expect(model.find).not.toHaveBeenCalled();
  });
  it('uses a literal escaped OR search and AND filters with an inclusion projection', async () => {
    const result = await service.listAccounts(admin, {
      search: '  .*a+[b](c)?^$|\\  ',
      role: Role.USER,
      status: AccountStatus.ACTIVE,
      page: 1,
      limit: 10,
    });
    expect(model.find).toHaveBeenCalledWith(
      {
        role: Role.USER,
        status: AccountStatus.ACTIVE,
        $or: [
          {
            name: {
              $regex: '\\.\\*a\\+\\[b\\]\\(c\\)\\?\\^\\$\\|\\\\',
              $options: 'i',
            },
          },
          {
            email: {
              $regex: '\\.\\*a\\+\\[b\\]\\(c\\)\\?\\^\\$\\|\\\\',
              $options: 'i',
            },
          },
        ],
      },
      { _id: 1, name: 1, email: 1, role: 1, status: 1, createdAt: 1 },
    );
    expect(result.items).toEqual([
      {
        id: row._id.toString(),
        name: row.name,
        email: row.email,
        role: row.role,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      },
    ]);
    expect(model.find.mock.results[0].value.sort).toHaveBeenCalledWith({
      _id: 1,
    });
  });
  it('revalidates internal inputs rather than forwarding Mongo operators', async () => {
    for (const query of [
      { role: { $ne: Role.ADMIN } },
      { search: ['one', 'two'] },
      { status: 'UNKNOWN' },
      { search: 'x'.repeat(101) },
      { limit: 51 },
      { page: 0 },
      { $where: 'synthetic' },
    ])
      await expect(
        service.listAccounts(admin, query as unknown as ListAccountsQueryDto),
      ).rejects.toMatchObject({ status: 400 });
    expect(model.find).not.toHaveBeenCalled();
  });
  it('treats trimmed blank search as no search', async () => {
    await service.listAccounts(admin, {
      ...new ListAccountsQueryDto(),
      search: '   ',
    });
    expect(model.find.mock.calls[0][0]).toEqual({});
  });
  it('rejects retrieval failures without exposing a driver message or cause', async () => {
    model.find.mockImplementationOnce(() => {
      throw new Error('synthetic-private-database-diagnostic');
    });
    await expect(
      service.listAccounts(admin, new ListAccountsQueryDto()),
    ).rejects.toThrow('Accounts could not be retrieved');
  });
});
