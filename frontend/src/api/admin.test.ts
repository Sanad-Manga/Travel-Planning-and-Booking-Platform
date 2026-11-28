import { afterEach, expect, it, vi } from 'vitest';
import { setUnauthorizedHandler } from '@/lib/api';
import { adminAccountsPath, reactivateAccount, resetAccountPassword, suspendAccount } from './admin';
import { adminProvidersPath, createModerator, type CreateModeratorBody } from './admin';

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
const base = { name: 'Synthetic Moderator', email: 'moderator@example.test', temporaryPassword: 'Synthetic9Pass' };
const id = '6730a1f2c3d4e5f607182931';

it.each([
  { ...base, role: 'AIRLINE_MODERATOR', airlineId: id },
  { ...base, role: 'HOTEL_MODERATOR', hotelId: id },
] satisfies CreateModeratorBody[])('posts only the typed body for $role', async (body) => {
  const response = { id, name: body.name, email: body.email, role: body.role };
  const fetchMock = vi.fn().mockResolvedValue(Response.json(response, { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(adminProvidersPath).toBe('/api/admin/providers');
  expect(await createModerator(body)).toEqual(response);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/moderators', expect.objectContaining({
    method: 'POST', credentials: 'include', body: JSON.stringify(body),
  }));
});

it('propagates a 401 and uses the unauthorized handler without a refresh or replay', async () => {
  const redirect = vi.fn();
  setUnauthorizedHandler(redirect);
  const fetchMock = vi.fn().mockResolvedValue(Response.json({}, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(createModerator({ ...base, role: 'AIRLINE_MODERATOR', airlineId: id })).rejects.toMatchObject({ status: 401 });
  expect(redirect).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
