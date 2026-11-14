import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../enums';
import { AuthenticatedRequest } from '../interfaces/authenticated-request';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

const contextFor = (request: Partial<AuthenticatedRequest>): ExecutionContext =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const jwtService = { verifyAsync: jest.fn() };
  const accounts = { isActive: jest.fn(), getAuthenticationState: jest.fn() };
  const guard = new JwtAuthGuard(jwtService as unknown as JwtService, reflector as unknown as Reflector, accounts);

  beforeEach(() => {
    jest.resetAllMocks();
    accounts.getAuthenticationState.mockResolvedValue({ active: true, tokenVersion: 0, mustChangePassword: false });
  });

  it('lets @Public routes through without looking at the cookie or the account', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(contextFor({ cookies: {} }))).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    expect(accounts.getAuthenticationState).not.toHaveBeenCalled();
  });

  it('401 when the cookie is missing', async () => {
    await expect(guard.canActivate(contextFor({ cookies: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 when the token fails verification (bad signature or expired)', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    await expect(guard.canActivate(contextFor({ cookies: { access_token: 'x' } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 when a validly signed token has unexpected claims', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', role: 'SUPERUSER' });
    await expect(guard.canActivate(contextFor({ cookies: { access_token: 'x' } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('builds the principal from the claims', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', role: Role.HOTEL_MODERATOR, hotelId: 'h1' });
    const request: Partial<AuthenticatedRequest> = { cookies: { access_token: 'x' } };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({ userId: 'u1', role: Role.HOTEL_MODERATOR, hotelId: 'h1', tokenVersion: 0 });
    expect(accounts.getAuthenticationState).toHaveBeenCalledWith('u1');
  });

  it('401 when the account is no longer active (suspended, deactivated or deleted) even with a valid token', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', role: Role.USER });
    accounts.getAuthenticationState.mockResolvedValue({ active: false, tokenVersion: 0, mustChangePassword: false });
    const request: Partial<AuthenticatedRequest> = { cookies: { access_token: 'x' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });

  it('does not check the account when the token itself is already invalid', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    await expect(guard.canActivate(contextFor({ cookies: { access_token: 'x' } }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(accounts.getAuthenticationState).not.toHaveBeenCalled();
  });

  it('fails closed: if the account lookup itself fails, the error propagates and nobody gets in', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', role: Role.USER });
    accounts.getAuthenticationState.mockRejectedValue(new Error('database down'));
    const request: Partial<AuthenticatedRequest> = { cookies: { access_token: 'x' } };
    await expect(guard.canActivate(contextFor(request))).rejects.toThrow('database down');
    expect(request.user).toBeUndefined();
  });

  it.each([undefined, 0, 1, -1, 1.5, '2', null])('rejects stale or malformed token version %p on a reset account', async tokenVersion => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', role: Role.USER, tokenVersion });
    accounts.getAuthenticationState.mockResolvedValue({ active: true, tokenVersion: 2, mustChangePassword: false });
    await expect(guard.canActivate(contextFor({ cookies: { access_token: 'x' } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses explicit handler metadata to allow forced replacement; defaults to denial', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', role: Role.USER, tokenVersion: 2 });
    accounts.getAuthenticationState.mockResolvedValue({ active: true, tokenVersion: 2, mustChangePassword: true });
    await expect(guard.canActivate(contextFor({ cookies: { access_token: 'x' } }))).rejects.toBeInstanceOf(ForbiddenException);
    reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(true);
    await expect(guard.canActivate(contextFor({ cookies: { access_token: 'x' } }))).resolves.toBe(true);
  });
});

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new RolesGuard(reflector as unknown as Reflector);

  beforeEach(() => jest.resetAllMocks());

  it('allows any logged-in user when no @Roles is set', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextFor({}))).toBe(true);
  });

  it('allows a listed role', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    expect(guard.canActivate(contextFor({ user: { userId: 'u', role: Role.ADMIN } }))).toBe(true);
  });

  it('403 for a role that is not listed, or when there is no principal', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(contextFor({ user: { userId: 'u', role: Role.USER } }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor({}))).toThrow(ForbiddenException);
  });
});
