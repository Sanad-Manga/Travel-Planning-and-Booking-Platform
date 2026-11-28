import { afterEach, expect, it, vi } from 'vitest';
import { setUnauthorizedHandler } from '@/lib/api';
import { adminProvidersPath, createModerator, deactivateProvider, reactivateProvider, type CreateModeratorBody } from './admin';

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

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

it.each([
  [deactivateProvider, 'airline', 'deactivate', false],
  [reactivateProvider, 'hotel', 'reactivate', true],
] as const)('patches provider status without a body', async (change, type, action, isActive) => {
  const response = { type, id: 'a/b?', isActive };
  const http = vi.fn().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', http);
  await expect(change(type, response.id)).resolves.toEqual(response);
  const url = '/api/admin/providers/' + type + '/a%2Fb%3F/' + action;
  expect(http).toHaveBeenCalledExactlyOnceWith(url, expect.objectContaining({ method: 'PATCH', body: undefined, credentials: 'include' }));
});

it('redirects a provider status 401 without replaying the mutation', async () => {
  const redirect = vi.fn();
  setUnauthorizedHandler(redirect);
  const http = vi.fn().mockResolvedValue(Response.json({}, { status: 401 }));
  vi.stubGlobal('fetch', http);
  await expect(deactivateProvider('hotel', id)).rejects.toMatchObject({ status: 401 });
  expect(redirect).toHaveBeenCalledOnce();
  expect(http).toHaveBeenCalledTimes(1);
});
