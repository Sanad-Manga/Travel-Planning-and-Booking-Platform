import { afterEach, expect, it, vi } from 'vitest';
import { setUnauthorizedHandler } from '@/lib/api';
import { adminAccountsPath, reactivateAccount, resetAccountPassword, suspendAccount } from './admin';

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

it.each([
  [suspendAccount, 'PATCH', '/api/admin/accounts/a%2Fb/suspend'],
  [reactivateAccount, 'PATCH', '/api/admin/accounts/a%2Fb/reactivate'],
  [resetAccountPassword, 'POST', '/api/admin/users/a%2Fb/reset-password'],
] as const)('uses the cookie client with an encoded ID and empty body', async (call, method, path) => {
  const response = { id: 'a/b' };
  const http = vi.fn().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', http);
  expect(adminAccountsPath).toBe('/api/admin/accounts');
  expect(await call('a/b')).toEqual(response);
  expect(http).toHaveBeenCalledExactlyOnceWith(path, expect.objectContaining({ method, body: undefined, credentials: 'include' }));
});

it('propagates a reset failure and redirects a lost session without refreshing or replaying', async () => {
  const redirect = vi.fn();
  setUnauthorizedHandler(redirect);
  const http = vi.fn().mockResolvedValue(Response.json({}, { status: 401 }));
  vi.stubGlobal('fetch', http);
  await expect(resetAccountPassword('target')).rejects.toMatchObject({ status: 401 });
  expect(redirect).toHaveBeenCalledOnce();
  expect(http).toHaveBeenCalledTimes(1);
});
