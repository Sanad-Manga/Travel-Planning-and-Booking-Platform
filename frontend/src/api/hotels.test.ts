import { afterEach, expect, it, vi } from 'vitest';
import { setUnauthorizedHandler } from '@/lib/api';
import { createHotel } from './hotels';

const body = { name: 'Example Hotel', address: '1 Test Street', cityId: 'CAI', description: 'Near the river', starRating: 4 };

afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(null); });

it('posts hotel creation with a seeded city ID', async () => {
  const result = { ...body, id: 'hotel-id', countryCode: 'EG' };
  const http = vi.fn().mockResolvedValue(Response.json(result, { status: 201 }));
  vi.stubGlobal('fetch', http);
  await expect(createHotel(body)).resolves.toEqual(result);
  expect(http).toHaveBeenCalledExactlyOnceWith('/api/hotels', expect.objectContaining({
    method: 'POST', credentials: 'include', body: JSON.stringify(body),
  }));
});

it('redirects without replaying an unauthorized hotel creation', async () => {
  const redirect = vi.fn();
  setUnauthorizedHandler(redirect);
  const http = vi.fn().mockResolvedValue(Response.json({}, { status: 401 }));
  vi.stubGlobal('fetch', http);
  await expect(createHotel(body)).rejects.toMatchObject({ status: 401 });
  expect(redirect).toHaveBeenCalledOnce();
  expect(http).toHaveBeenCalledTimes(1);
});
