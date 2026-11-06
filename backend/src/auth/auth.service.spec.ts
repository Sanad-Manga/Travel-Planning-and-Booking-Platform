import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { compare, hashSync } from 'bcryptjs';
import { AccountStatus, Role } from '../common';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { TokenRevocationService } from './token-revocation.service';

const ID = '6730a1f2c3d4e5f607182930';

describe('AuthService', () => {
  let service: AuthService;
  const usersService = { findByEmail: jest.fn(), findById: jest.fn(), create: jest.fn() };
  const jwtService = { signAsync: jest.fn(), verifyAsync: jest.fn() };
  const revocations = { revoke: jest.fn(), isRevoked: jest.fn() };
  const claims = (extra: Record<string, unknown> = {}) => ({ sub: ID, jti: 'jti-1', exp: 1_900_000_000, ...extra });
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
        { provide: TokenRevocationService, useValue: revocations },
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
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: ID },
        { secret: 'r'.repeat(32), expiresIn: 30 * 60, jwtid: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      );
    });

    it('gives every refresh token a different jti', async () => {
      usersService.findByEmail.mockResolvedValue(userDoc());
      await service.login(credentials);
      await service.login(credentials);
      const jtis = jwtService.signAsync.mock.calls.filter((call) => call[1]?.jwtid).map((call) => call[1].jwtid);
      expect(jtis).toHaveLength(2);
      expect(jtis[0]).not.toBe(jtis[1]);
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

  describe('refresh', () => {
    beforeEach(() => {
      jwtService.verifyAsync.mockResolvedValue(claims());
      revocations.isRevoked.mockResolvedValue(false);
    });

    it('verifies with the refresh secret and HS256, then issues a new access AND refresh token', async () => {
      usersService.findById.mockResolvedValue(userDoc());
      const result = await service.refresh('old.refresh.token');
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('old.refresh.token', { secret: 'r'.repeat(32), algorithms: ['HS256'] });
      expect(result).toMatchObject({ accessToken: 'signed.jwt.token', refreshToken: 'signed.jwt.token' });
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(result.user)).not.toContain('passwordHash');
    });

    it('re-reads role and ids from the database instead of trusting the old token', async () => {
      jwtService.verifyAsync.mockResolvedValue(claims({ role: Role.ADMIN }));
      usersService.findById.mockResolvedValue(userDoc({ role: Role.HOTEL_MODERATOR, hotelId: { toString: () => 'hotel-1' } }));
      await service.refresh('old.refresh.token');
      expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: ID, role: Role.HOTEL_MODERATOR, hotelId: 'hotel-1' });
    });

    it.each([undefined, null, '', 123])('401 "Invalid or expired session" for a missing token (%p)', async (token) => {
      await expect(service.refresh(token)).rejects.toThrow('Invalid or expired session');
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('401 when the token fails verification (tampered, expired or wrong secret)', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      await expect(service.refresh('bad')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('401 when the verified token has no usable sub', async () => {
      jwtService.verifyAsync.mockResolvedValue({});
      await expect(service.refresh('x')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it.each([AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED])('401 when the user is %s', async (status) => {
      usersService.findById.mockResolvedValue(userDoc({ status }));
      await expect(service.refresh('x')).rejects.toThrow('Invalid or expired session');
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('401 when the user no longer exists', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.refresh('x')).rejects.toBeInstanceOf(UnauthorizedException);
    });
    it('401 when the token has no jti (cannot be checked against the revocation list)', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: ID, exp: 1_900_000_000 });
      await expect(service.refresh('x')).rejects.toThrow('Invalid or expired session');
    });

    it('401 for a revoked token (ACC-06): the user is not even loaded and nothing is signed', async () => {
      revocations.isRevoked.mockResolvedValue(true);
      await expect(service.refresh('x')).rejects.toThrow('Invalid or expired session');
      expect(revocations.isRevoked).toHaveBeenCalledWith('jti-1');
      expect(usersService.findById).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('logout (ACC-06)', () => {
    it('revokes the jti until the token would have expired, for the right user', async () => {
      jwtService.verifyAsync.mockResolvedValue(claims());
      await service.logout('good.refresh.token');
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('good.refresh.token', { secret: 'r'.repeat(32), algorithms: ['HS256'] });
      expect(revocations.revoke).toHaveBeenCalledWith('jti-1', ID, new Date(1_900_000_000 * 1000));
    });

    it.each([undefined, null, '', 123])('does nothing and does not throw without a token (%p)', async (token) => {
      await expect(service.logout(token)).resolves.toBeUndefined();
      expect(revocations.revoke).not.toHaveBeenCalled();
    });

    it('ignores a token that fails verification (tampered, expired, access token)', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));
      await expect(service.logout('bad')).resolves.toBeUndefined();
      expect(revocations.revoke).not.toHaveBeenCalled();
    });

    it.each([{ sub: ID, exp: 1 }, { jti: 'j', exp: 1 }, { sub: 'not-an-id', jti: 'j', exp: 1 }])(
      'ignores a verified token with missing or malformed claims (%j)',
      async (payload) => {
        jwtService.verifyAsync.mockResolvedValue(payload);
        await service.logout('x');
        expect(revocations.revoke).not.toHaveBeenCalled();
      },
    );
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
