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
  const guard = new JwtAuthGuard(jwtService as unknown as JwtService, reflector as unknown as Reflector);

  beforeEach(() => jest.resetAllMocks());

  it('lets @Public routes through without looking at the cookie', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(contextFor({ cookies: {} }))).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
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
    expect(request.user).toEqual({ userId: 'u1', role: Role.HOTEL_MODERATOR, hotelId: 'h1' });
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
