import { afterEach, expect, it, vi } from 'vitest';
import { setUnauthorizedHandler } from '@/lib/api';
import { createAirline } from './airlines';

afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(null); });

it('posts the airline contract and returns the created provider', async () => {
  const body = { name: 'Example Air', code: 'A1' };
  const result = { ...body, id: 'airline-id', isActive: true };
  const http = vi.fn().mockResolvedValue(Response.json(result, { status: 201 }));
  vi.stubGlobal('fetch', http);
  await expect(createAirline(body)).resolves.toEqual(result);
  expect(http).toHaveBeenCalledExactlyOnceWith('/api/airlines', expect.objectContaining({
    method: 'POST', credentials: 'include', body: JSON.stringify(body),
  }));
});

it('redirects after an unauthorized response without replaying the POST', async () => {
  const redirect = vi.fn();
  setUnauthorizedHandler(redirect);
  const http = vi.fn().mockResolvedValue(Response.json({}, { status: 401 }));
  vi.stubGlobal('fetch', http);
  await expect(createAirline({ name: 'Example Air', code: 'A1' })).rejects.toMatchObject({ status: 401 });
  expect(redirect).toHaveBeenCalledOnce();
  expect(http).toHaveBeenCalledTimes(1);
});
