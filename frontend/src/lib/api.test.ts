import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setUnauthorizedHandler } from './api';
import { toFriendlyError } from './apiError';

const fetchMock = vi.fn();

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const errorBody = (statusCode: number, over: Record<string, unknown> = {}) => ({
  statusCode,
  error: 'Error',
  message: 'Something',
  path: '/api/x',
  timestamp: '2026-11-02T10:00:00.000Z',
  ...over,
});

const onUnauthorized = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  onUnauthorized.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setUnauthorizedHandler(onUnauthorized);
  window.history.replaceState(null, '', '/trips?id=5');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe('api (ACC-10): requests', () => {
  it('calls same-origin /api with cookies and returns parsed JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: '1' }));
    await expect(api('/flights/1')).resolves.toEqual({ id: '1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/flights/1');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('GET');
    expect(init.headers.Accept).toBe('application/json');
  });

  it('does not double the /api prefix', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await api('/api/flights');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/flights');
  });

  it('sends a JSON body with a content type', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await api('/auth/login', { method: 'POST', body: { email: 'a@b.com', password: 'x' } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.com', password: 'x' });
  });

  it('sends no body and no content type on a GET', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await api('/flights');
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('returns undefined for 204 and for an empty body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api('/x', { method: 'DELETE' })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    await expect(api('/x')).resolves.toBeUndefined();
  });

  it('lets a network failure through as the original TypeError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await api('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(toFriendlyError(error).message).toMatch(/couldn.t reach the server/i);
  });
});

describe('ApiError (ACC-10): mapping the backend error shape', () => {
  it('carries statusCode, message and details from the body', async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        400,
        errorBody(400, {
          error: 'Bad Request',
          message: 'Validation failed',
          details: [{ field: 'email', message: 'email must be valid' }],
        }),
      ),
    );
    const error = (await api('/auth/register', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('Validation failed');
    expect(error.details).toEqual([{ field: 'email', message: 'email must be valid' }]);
    expect(error.retryAfter).toBeNull();
  });

  it('reads Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(json(429, errorBody(429, { message: 'Too many' }), { 'Retry-After': '30' }));
    const error = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(error.statusCode).toBe(429);
    expect(error.retryAfter).toBe('30');
  });

  it('works with toFriendlyError directly', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, errorBody(400, { details: [{ field: 'password', message: 'too short' }] })),
    );
    const error = await api('/x').catch((e: unknown) => e);
    expect(toFriendlyError(error).fieldErrors).toEqual({ password: 'too short' });
  });

  it('defaults details to an empty array and ignores malformed entries', async () => {
    fetchMock.mockResolvedValueOnce(json(409, errorBody(409, { message: 'Sold out' })));
    const first = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(first.details).toEqual([]);

    fetchMock.mockResolvedValueOnce(json(400, errorBody(400, { details: [null, { field: 1 }, { field: 'a', message: 'b' }] })));
    const second = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(second.details).toEqual([{ field: 'a', message: 'b' }]);
  });

  it('copes with an error body that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(error.statusCode).toBe(502);
    expect(error.message).toBe('Request failed (502)');
    expect(error.details).toEqual([]);
  });
});

describe('api (ACC-10): 401 refresh and retry', () => {
  it('refreshes once and retries the request once, returning the retried result', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, errorBody(401)))
      .mockResolvedValueOnce(json(200, { id: 'u1' }))
      .mockResolvedValueOnce(json(200, { items: [] }));
    await expect(api('/bookings')).resolves.toEqual({ items: [] });
    expect(fetchMock.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      ['/api/bookings', 'GET'],
      ['/api/auth/refresh', 'POST'],
      ['/api/bookings', 'GET'],
    ]);
    expect(fetchMock.mock.calls[1][1].credentials).toBe('include');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('resends the same body when it retries', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, errorBody(401)))
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(json(201, { id: 'b1' }));
    await api('/flight-bookings', { method: 'POST', body: { flightId: 'f1' } });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ flightId: 'f1' });
  });

  it('redirects to login with returnTo when the refresh is refused', async () => {
    fetchMock.mockResolvedValueOnce(json(401, errorBody(401))).mockResolvedValueOnce(json(401, errorBody(401)));
    const error = (await api('/bookings').catch((e: unknown) => e)) as ApiError;
    expect(error.statusCode).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no retry of the request
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledWith('/trips?id=5');
  });

  it('redirects when the refresh itself cannot reach the server', async () => {
    fetchMock.mockResolvedValueOnce(json(401, errorBody(401))).mockRejectedValueOnce(new TypeError('offline'));
    await expect(api('/bookings')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('retries only once: a second 401 redirects and does not refresh again', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, errorBody(401)))
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(json(401, errorBody(401)));
    await expect(api('/bookings')).rejects.toMatchObject({ statusCode: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between requests that fail at the same time (refresh tokens are single use)', async () => {
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') {
        refreshCalls++;
        return json(200, {});
      }
      const seen = fetchMock.mock.calls.filter((c) => c[0] === url).length;
      return seen === 1 ? json(401, errorBody(401)) : json(200, { url });
    });
    const [a, b] = await Promise.all([api('/a'), api('/b')]);
    expect(a).toEqual({ url: '/api/a' });
    expect(b).toEqual({ url: '/api/b' });
    expect(refreshCalls).toBe(1);
  });

  it('login (retryOn401 and redirectOn401 off) reports bad credentials without refreshing or redirecting', async () => {
    fetchMock.mockResolvedValueOnce(json(401, errorBody(401, { message: 'Invalid credentials' })));
    await expect(
      api('/auth/login', { method: 'POST', body: {}, retryOn401: false, redirectOn401: false }),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('the session check can refresh but never redirects (a guest is normal)', async () => {
    fetchMock.mockResolvedValueOnce(json(401, errorBody(401))).mockResolvedValueOnce(json(401, errorBody(401)));
    await expect(api('/auth/me', { redirectOn401: false })).rejects.toMatchObject({ statusCode: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('never refreshes in response to the refresh endpoint itself', async () => {
    fetchMock.mockResolvedValueOnce(json(401, errorBody(401)));
    await expect(api('/auth/refresh', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not redirect when already on the login page', async () => {
    window.history.replaceState(null, '', '/login?returnTo=%2Ftrips');
    fetchMock.mockResolvedValueOnce(json(401, errorBody(401))).mockResolvedValueOnce(json(401, errorBody(401)));
    await expect(api('/bookings')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('other statuses (403, 404) never trigger a refresh', async () => {
    fetchMock.mockResolvedValueOnce(json(403, errorBody(403)));
    await expect(api('/admin/x')).rejects.toMatchObject({ statusCode: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('api (GEN-08): multipart requests', () => {
  function imageBody() {
    const body = new FormData();
    body.append('image', new File(['png'], 'image.png', { type: 'image/png' }));
    return body;
  }

  it('passes FormData through with cookies and lets fetch set its multipart boundary', async () => {
    const body = imageBody();
    fetchMock.mockResolvedValueOnce(json(201, { id: 'image', url: '/uploads/image.png' }));
    await expect(api('/posts/post/images', { method: 'POST', body })).resolves.toEqual({
      id: 'image',
      url: '/uploads/image.png',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/posts/post/images');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBe(body);
  });

  it('uses the existing refresh flow and resends the original FormData once', async () => {
    const body = imageBody();
    fetchMock
      .mockResolvedValueOnce(json(401, errorBody(401)))
      .mockResolvedValueOnce(json(200, {}))
      .mockResolvedValueOnce(json(201, { id: 'image' }));
    await expect(api('/activities/activity/images', { method: 'POST', body })).resolves.toEqual({ id: 'image' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/activities/activity/images', '/api/auth/refresh', '/api/activities/activity/images',
    ]);
    for (const [, init] of fetchMock.mock.calls) expect(init.credentials).toBe('include');
    expect(fetchMock.mock.calls[0][1].body).toBe(body);
    expect(fetchMock.mock.calls[2][1].body).toBe(body);
    expect(fetchMock.mock.calls[2][1].headers['Content-Type']).toBeUndefined();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each([413, 503])('exposes a %i upload error as ApiError without retrying', async (status) => {
    const message = 'Upload rejected';
    fetchMock.mockResolvedValueOnce(json(status, errorBody(status, { message })));
    const error = await api('/airlines/airline/logo', { method: 'POST', body: imageBody() }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: status, message });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
