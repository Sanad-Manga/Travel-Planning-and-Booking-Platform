import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { airportsKey, countriesKey, listAirports, listCountries } from './referenceData';

const page = { items: [{ code: 'EG', name: 'Egypt', currency: 'EGP' }], page: 1, limit: 10, total: 1, totalPages: 1 };

describe('reference-data endpoint functions', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('build the key from the path and query', () => {
    expect(airportsKey({ page: 2 })).toBe('/api/airports?page=2');
    expect(countriesKey()).toBe('/api/countries');
  });

  it('listCountries sends a same-origin GET with cookies and returns the page', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }));
    await expect(listCountries({ limit: 10 })).resolves.toEqual(page);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/countries?limit=10');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
  });

  it('listAirports surfaces the backend error as an ApiError', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 400, error: 'Bad Request', message: 'Validation failed', details: [{ field: 'limit', message: 'limit must not be greater than 50' }] }), { status: 400 }),
    );
    await expect(listAirports({ limit: 500 })).rejects.toMatchObject({ statusCode: 400, details: [{ field: 'limit', message: 'limit must not be greater than 50' }] });
  });
});
