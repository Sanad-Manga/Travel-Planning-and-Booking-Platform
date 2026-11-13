import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthenticatedUser, Role } from '../common';
import { AccountDeactivationService } from './account-deactivation.service';
import { ProfileService } from './profile.service';
import { UsersController } from './users.controller';

// Only the cookie-flag decision of DELETE /users/me is tested here; the rules are in account-deactivation.service.spec.ts.
describe('UsersController.deactivate cookie flags (ACC-12)', () => {
  const current: AuthenticatedUser = { userId: 'u1', role: Role.USER };
  const deactivation = { deactivate: jest.fn().mockResolvedValue(undefined) } as unknown as AccountDeactivationService;
  const profile = {} as ProfileService;
  const fakeRes = () => ({ clearCookie: jest.fn() }) as unknown as Response & { clearCookie: jest.Mock };
  const configWith = (cookieSecure: boolean | undefined) => ({ get: jest.fn().mockReturnValue(cookieSecure) }) as unknown as ConfigService;
  const secureFlags = (res: { clearCookie: jest.Mock }) => res.clearCookie.mock.calls.map((call: unknown[]) => (call[1] as { secure: boolean }).secure);

  it('uses cookieSecure from the config, for both cookies (this is the path the real app takes)', async () => {
    const res = fakeRes();
    await new UsersController(profile, deactivation, configWith(true)).deactivate(current, { confirm: true }, res);
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
    expect(secureFlags(res)).toEqual([true, true]);
  });

  it('falls back to non-secure only when NO ConfigService exists (the @Optional() case of test apps), and still clears both cookies', async () => {
    const res = fakeRes();
    await expect(new UsersController(profile, deactivation, undefined).deactivate(current, { confirm: true }, res)).resolves.toEqual({
      message: 'Account deactivated',
    });
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
    expect(secureFlags(res)).toEqual([false, false]);
  });
});
