import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listAll } from './referenceData';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('listAll', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('walks every page at the maximum page size and joins the items in order', async () => {
    fetchMock.mockImplementation((url: string) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      return Promise.resolve(json({ items: [`item${page}`], page, limit: 50, total: 3, totalPages: 3 }));
    });
    await expect(listAll<string>('/api/cities', { countryCode: 'EG' })).resolves.toEqual(['item1', 'item2', 'item3']);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/cities?countryCode=EG&page=1&limit=50',
      '/api/cities?countryCode=EG&page=2&limit=50',
      '/api/cities?countryCode=EG&page=3&limit=50',
    ]);
  });

  it('makes one request when everything fits on the first page', async () => {
    fetchMock.mockResolvedValue(json({ items: ['EGP'], page: 1, limit: 50, total: 1, totalPages: 1 }));
    await expect(listAll<string>('/api/currencies')).resolves.toEqual(['EGP']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
