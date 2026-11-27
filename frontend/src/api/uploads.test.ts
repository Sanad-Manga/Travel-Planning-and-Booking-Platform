import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResponseOf } from './types';
import { removeImage, uploadImage, type RemoveImageEndpoint, type UploadImageEndpoint } from './uploads';

const http = vi.fn<(url: string, options: RequestInit) => Promise<Response>>();
const id = 'entity /?#%';
const imageId = 'image /?#%';
const encodedId = 'entity%20%2F%3F%23%25';
const encodedImageId = 'image%20%2F%3F%23%25';
const current = { id: 'new-image', url: '/uploads/new.png' };
const previous = { id: 'old-image', url: '/uploads/old.png' };
const file = new File(['synthetic image'], 'fixture.png', { type: 'image/png' });

beforeEach(() => { http.mockReset(); vi.stubGlobal('fetch', http); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('uploadImage', () => {
  const activity: ResponseOf<'/api/activities/{id}/images', 'post'> = {
    id, itineraryId: 'fixture-itinerary', dayId: 'fixture-day', name: 'Visit a museum',
    description: '', time: null, costCents: null, currency: 'USD', images: [previous, current],
  };

  const uploads = [
    ['post', `/api/posts/${encodedId}/images`, current],
    ['hotel', `/api/hotels/${encodedId}/photos`, current],
    ['airline', `/api/airlines/${encodedId}/logo`, current],
    ['activity', `/api/activities/${encodedId}/images`, activity],
  ] satisfies [UploadImageEndpoint['kind'], string, unknown][];

  it.each(uploads)('posts the original file and returns the correct %s image', async (kind, path, response) => {
    http.mockResolvedValueOnce(Response.json(response, { status: 201 }));
    const { signal } = new AbortController();
    await expect(uploadImage({ kind, id }, file, signal)).resolves.toEqual(current);
    expect(http).toHaveBeenCalledExactlyOnceWith(path, expect.objectContaining({
      method: 'POST', credentials: 'include', signal,
    }));
    const { body, headers } = http.mock.calls[0][1];
    expect(body).toBeInstanceOf(FormData);
    if (!(body instanceof FormData)) throw new Error('Expected FormData');
    expect([...body.keys()]).toEqual(['image']);
    expect(body.get('image')).toBe(file);
    expect(new Headers(headers).has('Content-Type')).toBe(false);
  });

  it.each([
    null,
    {},
    { images: {} },
    { images: [] },
    { images: [previous, null] },
    { images: [previous, { id: ' ', url: '/uploads/new.png' }] },
    { images: [previous, { id: 'new-image', url: 17 }] },
    { images: [previous, { id: 'new-image', url: '/uploads/' }] },
  ])('rejects an unidentifiable activity image without returning a previous image or replaying', async (response) => {
    http.mockResolvedValueOnce(Response.json(response, { status: 201 }));
    await expect(uploadImage({ kind: 'activity', id }, file)).rejects.toThrow('Reload the activity before trying again.');
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('preserves the shared authentication refresh after an explicit 401', async () => {
    http.mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(current, { status: 201 }));
    await expect(uploadImage({ kind: 'post', id }, file)).resolves.toEqual(current);
    expect(http.mock.calls.map(([url]) => url)).toEqual([
      `/api/posts/${encodedId}/images`, '/api/auth/refresh', `/api/posts/${encodedId}/images`,
    ]);
    expect(http.mock.calls[0][1].body).toBe(http.mock.calls[2][1].body);
  });

  it('propagates an ambiguous network failure without replay', async () => {
    const failure = new TypeError('offline');
    http.mockRejectedValueOnce(failure);
    await expect(uploadImage({ kind: 'hotel', id }, file)).rejects.toBe(failure);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('rejects dot segments before issuing a request', async () => {
    await expect(uploadImage({ kind: 'airline', id: '..' }, file)).rejects.toThrow('Invalid image route identifier');
    await expect(removeImage({ kind: 'activity', id, imageId: '.' })).rejects.toThrow('Invalid image route identifier');
    expect(http).not.toHaveBeenCalled();
  });
});

describe('removeImage', () => {
  const deletes: [RemoveImageEndpoint, string][] = [
    [{ kind: 'post', id, imageId }, `/api/posts/${encodedId}/images/${encodedImageId}`],
    [{ kind: 'hotel', id, imageId }, `/api/hotels/${encodedId}/photos/${encodedImageId}`],
    [{ kind: 'airline', id }, `/api/airlines/${encodedId}/logo`],
    [{ kind: 'activity', id, imageId }, `/api/activities/${encodedId}/images/${encodedImageId}`],
  ];

  it.each(deletes)('deletes %j via the documented path and accepts 204', async (endpoint, path) => {
    const { signal } = new AbortController();
    http.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(removeImage(endpoint, signal)).resolves.toBeUndefined();
    expect(http).toHaveBeenCalledExactlyOnceWith(path, expect.objectContaining({
      method: 'DELETE', body: undefined, credentials: 'include', signal,
    }));
  });

  it('keeps a void return if an updated API provides a successful JSON body', async () => {
    http.mockResolvedValueOnce(Response.json({ removed: true }));
    await expect(removeImage({ kind: 'airline', id })).resolves.toBeUndefined();
  });

  it('preserves the ApiError status, body details and retry header without replay', async () => {
    const body = { message: 'Deletion failed', details: [{ field: 'imageId', message: 'Image unavailable' }] };
    http.mockResolvedValueOnce(Response.json(body, { status: 503, headers: { 'Retry-After': '5' } }));
    await expect(removeImage({ kind: 'post', id, imageId })).rejects.toMatchObject({
      name: 'ApiError', statusCode: 503, message: body.message, details: body.details, body, retryAfter: '5',
    });
    expect(http).toHaveBeenCalledTimes(1);
  });
});
