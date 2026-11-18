import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { RequireVerifiedEmailGuard } from './require-verified-email.guard';

describe('RequireVerifiedEmailGuard (ACC-02)', () => {
  const users = { isEmailUnverified: jest.fn() };
  const moduleRef = { get: jest.fn(() => users) };
  const guard = new RequireVerifiedEmailGuard(moduleRef as never);
  const ctx = (user?: { userId: string }) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('lets a verified (or legacy, field-less) user through', async () => {
    users.isEmailUnverified.mockResolvedValue(false);
    await expect(guard.canActivate(ctx({ userId: 'u1' }))).resolves.toBe(true);
  });

  it('blocks an unverified user with 403 and a stable code', async () => {
    users.isEmailUnverified.mockResolvedValue(true);
    const error = await guard.canActivate(ctx({ userId: 'u1' })).catch((e: ForbiddenException) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      message: 'Verify your email before booking',
      details: [{ field: 'emailVerified', message: 'EMAIL_NOT_VERIFIED' }],
    });
  });

  it('answers 401 when there is no principal, without any lookup', async () => {
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.isEmailUnverified).not.toHaveBeenCalled();
  });

  it('fails closed when the lookup itself fails', async () => {
    users.isEmailUnverified.mockRejectedValue(new Error('db down'));
    await expect(guard.canActivate(ctx({ userId: 'u1' }))).rejects.toThrow('db down');
  });
});
