import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { compare } from 'bcryptjs';
import { AccountStatus, Role } from '../common';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService.register', () => {
  let service: AuthService;
  const usersService = { findByEmail: jest.fn(), create: jest.fn() };
  const dto = { name: 'Ali', email: 'ali@example.com', password: 'Passw0rdOK', acceptTerms: true };

  beforeEach(async () => {
    jest.resetAllMocks();
    usersService.create.mockImplementation((input) =>
      Promise.resolve({
        id: '6730a1f2c3d4e5f607182930',
        ...input,
        role: Role.USER,
        status: AccountStatus.ACTIVE,
        preferredCurrency: 'USD',
        createdAt: new Date(),
      }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [AuthService, { provide: UsersService, useValue: usersService }],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('stores a salted bcrypt hash, never the plaintext', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    await service.register(dto);
    const stored = usersService.create.mock.calls[0][0];
    expect(stored.passwordHash).not.toBe(dto.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    await expect(compare(dto.password, stored.passwordHash)).resolves.toBe(true);
    expect(stored.consentAcceptedAt).toBeInstanceOf(Date);
  });

  it('returns a response DTO without the hash and with role USER', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    const result = await service.register(dto);
    expect(result).toMatchObject({ id: '6730a1f2c3d4e5f607182930', email: dto.email, role: Role.USER, status: AccountStatus.ACTIVE });
    expect(JSON.stringify(result)).not.toContain('passwordHash');
  });

  it('rejects a duplicate email with a field-level 409 and creates nothing', async () => {
    usersService.findByEmail.mockResolvedValue({ id: 'existing' });
    const error = await service.register(dto).catch((e: ConflictException) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      details: [{ field: 'email', message: expect.any(String) }],
    });
    expect(usersService.create).not.toHaveBeenCalled();
  });
});
