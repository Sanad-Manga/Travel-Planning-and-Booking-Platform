import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { compare, hashSync } from 'bcryptjs';
import { AccountStatus, Role } from '../common';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

const ID = '6730a1f2c3d4e5f607182930';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = { findByEmail: jest.fn(), findById: jest.fn(), create: jest.fn() };
  const jwtService = { signAsync: jest.fn() };
  const dto = { name: 'Ali', email: 'ali@example.com', password: 'Passw0rdOK', acceptTerms: true };
  const storedHash = hashSync('Passw0rdOK', 4);

  const userDoc = (extra: Record<string, unknown> = {}) => ({
    id: ID,
    name: 'Ali',
    email: 'ali@example.com',
    passwordHash: storedHash,
    role: Role.USER,
    status: AccountStatus.ACTIVE,
    preferredCurrency: 'USD',
    consentAcceptedAt: new Date(),
    createdAt: new Date(),
    ...extra,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    usersService.create.mockImplementation((input) => Promise.resolve(userDoc(input)));
    jwtService.signAsync.mockResolvedValue('signed.jwt.token');
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        // Fake secrets, only for this test.
        { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'r'.repeat(32) }) },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('register', () => {
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
      expect(result).toMatchObject({ id: ID, email: dto.email, role: Role.USER, status: AccountStatus.ACTIVE });
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

  describe('login', () => {
    const credentials = { email: 'ali@example.com', password: 'Passw0rdOK' };

    it('returns the user and a signed token for an ACTIVE account, with the right claims', async () => {
      usersService.findByEmail.mockResolvedValue(userDoc());
      const result = await service.login(credentials);
      expect(usersService.findByEmail).toHaveBeenCalledWith('ali@example.com', true);
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toMatchObject({ id: ID, email: 'ali@example.com' });
      expect(JSON.stringify(result.user)).not.toContain('passwordHash');
      expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: ID, role: Role.USER });
    });

    it('also issues a refresh token signed with the refresh secret (user id only, 30 minutes)', async () => {
      usersService.findByEmail.mockResolvedValue(userDoc());
      await service.login(credentials);
      expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: ID }, { secret: 'r'.repeat(32), expiresIn: 30 * 60 });
    });

    it('puts the airlineId in the token for an airline moderator', async () => {
      usersService.findByEmail.mockResolvedValue(
        userDoc({ role: Role.AIRLINE_MODERATOR, airlineId: { toString: () => 'airline-1' } }),
      );
      await service.login(credentials);
      expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: ID, role: Role.AIRLINE_MODERATOR, airlineId: 'airline-1' });
    });

    it('wrong password -> 401 generic message, no token', async () => {
      usersService.findByEmail.mockResolvedValue(userDoc());
      const error = await service.login({ ...credentials, password: 'WrongPass1' }).catch((e: UnauthorizedException) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe('Invalid email or password');
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('unknown email -> the same 401 message', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const error = await service.login(credentials).catch((e: UnauthorizedException) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe('Invalid email or password');
    });

    it('SUSPENDED + correct password -> 403 "Account suspended"', async () => {
      usersService.findByEmail.mockResolvedValue(userDoc({ status: AccountStatus.SUSPENDED }));
      const error = await service.login(credentials).catch((e: ForbiddenException) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe('Account suspended');
    });

    it('SUSPENDED + wrong password -> generic 401 (password is checked first)', async () => {
      usersService.findByEmail.mockResolvedValue(userDoc({ status: AccountStatus.SUSPENDED }));
      await expect(service.login({ ...credentials, password: 'WrongPass1' })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('DEACTIVATED -> generic 401', async () => {
      usersService.findByEmail.mockResolvedValue(userDoc({ status: AccountStatus.DEACTIVATED }));
      await expect(service.login(credentials)).rejects.toThrow('Invalid email or password');
    });
  });

  describe('getCurrentUser', () => {
    it('returns the user DTO for an ACTIVE account', async () => {
      usersService.findById.mockResolvedValue(userDoc());
      await expect(service.getCurrentUser(ID)).resolves.toMatchObject({ id: ID });
    });

    it('401 when the user no longer exists or is not ACTIVE', async () => {
      usersService.findById.mockResolvedValueOnce(null);
      await expect(service.getCurrentUser(ID)).rejects.toBeInstanceOf(UnauthorizedException);
      usersService.findById.mockResolvedValueOnce(userDoc({ status: AccountStatus.SUSPENDED }));
      await expect(service.getCurrentUser(ID)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
