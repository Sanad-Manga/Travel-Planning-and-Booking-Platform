import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
}));

const { serverApi } = await import('./serverApi');

describe('serverApi', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    jar.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('BACKEND_URL', 'http://backend:3001');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('calls the backend directly, forwarding only the access cookie, never cached', async () => {
    jar.set('access_token', 'abc');
    jar.set('refresh_token', 'secret-refresh');
    jar.set('other', 'x');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Ali' }), { status: 200 }));

    await expect(serverApi('/api/auth/me')).resolves.toEqual({ ok: true, data: { name: 'Ali' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://backend:3001/api/auth/me');
    expect(init.cache).toBe('no-store');
    expect(init.headers.Cookie).toBe('access_token=abc');
  });

  it('sends no Cookie header for a guest', async () => {
    fetchMock.mockResolvedValue(new Response('{"items":[]}', { status: 200 }));
    await serverApi('/airports');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://backend:3001/api/airports');
    expect(init.headers.Cookie).toBeUndefined();
  });

  it('answers unauthorized on a 401 so the page can fall back to the browser', async () => {
    jar.set('access_token', 'expired');
    fetchMock.mockResolvedValue(new Response('{"statusCode":401,"message":"Unauthorized"}', { status: 401 }));
    await expect(serverApi('/api/auth/me')).resolves.toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('throws the backend error as an ApiError for any other failure', async () => {
    fetchMock.mockResolvedValue(new Response('{"statusCode":404,"message":"Flight not found"}', { status: 404 }));
    const error = await serverApi('/api/flights/1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 404, message: 'Flight not found' });
  });
});
