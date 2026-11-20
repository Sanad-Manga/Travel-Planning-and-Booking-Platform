import { describe, expect, it } from 'vitest';
import { failureFromResponse, toFriendlyError } from './apiError';

const apiBody = (over: Record<string, unknown> = {}) => ({
  statusCode: 400,
  error: 'Bad Request',
  message: 'Validation failed',
  path: '/api/auth/register',
  timestamp: '2026-11-02T10:00:00.000Z',
  ...over,
});

describe('toFriendlyError (GEN-16)', () => {
  it('turns validation details into a field-error map and a form-level sentence', () => {
    const result = toFriendlyError({
      status: 400,
      body: apiBody({
        details: [
          { field: 'email', message: 'email must be valid' },
          { field: 'password', message: 'password is too short' },
          { field: 'password', message: 'password needs a digit' },
        ],
      }),
    });
    expect(result.fieldErrors).toEqual({ email: 'email must be valid', password: 'password is too short' });
    expect(result.message).toBe('Some details need fixing.');
    expect(result.hint).toMatch(/fix the highlighted fields/i);
    expect(result.retryable).toBe(false);
  });

  it('uses the server message for a 400 without details', () => {
    const result = toFriendlyError({ status: 400, body: apiBody({ message: 'Return date must be after departure' }) });
    expect(result.message).toBe('Return date must be after departure');
    expect(result.fieldErrors).toEqual({});
  });

  it('ignores malformed details entries', () => {
    const result = toFriendlyError({
      status: 400,
      body: apiBody({ details: [null, { field: 3 }, { field: 'a', message: 'bad' }] }),
    });
    expect(result.fieldErrors).toEqual({ a: 'bad' });
  });

  it('explains a network failure and offers a retry', () => {
    const result = toFriendlyError(new TypeError('Failed to fetch'));
    expect(result.message).toMatch(/couldn.t reach the server/i);
    expect(result.hint).toMatch(/connection/i);
    expect(result.retryable).toBe(true);
  });

  it('401: session ended, sign in again', () => {
    const result = toFriendlyError({ status: 401, body: apiBody({ statusCode: 401, message: 'Unauthorized' }) });
    expect(result.message).toMatch(/signed out|session/i);
    expect(result.hint).toMatch(/sign in/i);
  });

  it('403: no permission', () => {
    const result = toFriendlyError({ status: 403 });
    expect(result.message).toMatch(/permission/i);
    expect(result.hint).toBeTruthy();
  });

  it('404: not found, with a way back', () => {
    const result = toFriendlyError({ status: 404 });
    expect(result.message).toMatch(/couldn.t find/i);
    expect(result.hint).toMatch(/go back|check/i);
  });

  it('409: shows the server reason, since it says what clashed', () => {
    const result = toFriendlyError({ status: 409, body: apiBody({ statusCode: 409, message: 'Only 2 seats left' }) });
    expect(result.message).toBe('Only 2 seats left');
    expect(result.hint).toMatch(/refresh|change/i);
  });

  it('409 without a body falls back to a plain sentence', () => {
    expect(toFriendlyError({ status: 409 }).message).toMatch(/changed|conflict/i);
  });

  it('429 with Retry-After in seconds tells the user how long to wait', () => {
    const result = toFriendlyError({ status: 429, retryAfter: '30' });
    expect(result.message).toMatch(/too many requests/i);
    expect(result.hint).toContain('30 seconds');
    expect(result.retryable).toBe(true);
  });

  it('429 with a one second wait is singular, and a long wait is in minutes', () => {
    expect(toFriendlyError({ status: 429, retryAfter: 1 }).hint).toContain('1 second.');
    expect(toFriendlyError({ status: 429, retryAfter: '120' }).hint).toContain('2 minutes');
  });

  it('429 with Retry-After as an HTTP date', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    const result = toFriendlyError({ status: 429, retryAfter: 'Fri, 20 Nov 2026 10:00:45 GMT' }, now);
    expect(result.hint).toContain('45 seconds');
  });

  it('429 without a usable Retry-After still gives a hint', () => {
    expect(toFriendlyError({ status: 429, retryAfter: 'soon' }).hint).toMatch(/moment/i);
    expect(toFriendlyError({ status: 429 }).hint).toMatch(/moment/i);
  });

  it('5xx never leaks server text and is retryable', () => {
    const result = toFriendlyError({
      status: 503,
      body: apiBody({ statusCode: 503, message: 'MongoServerError: boom' }),
    });
    expect(result.message).not.toContain('Mongo');
    expect(result.message).toMatch(/something went wrong on our side/i);
    expect(result.retryable).toBe(true);
  });

  it('anything else gets a generic sentence', () => {
    expect(toFriendlyError('weird').message).toMatch(/something went wrong/i);
    expect(toFriendlyError({ status: 418 }).message).toMatch(/something went wrong/i);
    expect(toFriendlyError(undefined).fieldErrors).toEqual({});
  });

  it('always returns a message and hint', () => {
    for (const status of [400, 401, 403, 404, 409, 429, 500, 502]) {
      const result = toFriendlyError({ status });
      expect(result.message).toBeTruthy();
      expect(result.hint).toBeTruthy();
    }
  });
});

describe('failureFromResponse', () => {
  it('reads status, JSON body and Retry-After', async () => {
    const response = new Response(JSON.stringify(apiBody({ statusCode: 429 })), {
      status: 429,
      headers: { 'Retry-After': '10', 'Content-Type': 'application/json' },
    });
    const failure = await failureFromResponse(response);
    expect(failure.status).toBe(429);
    expect(failure.retryAfter).toBe('10');
    expect(failure.body).toMatchObject({ message: 'Validation failed' });
    expect(toFriendlyError(failure).hint).toContain('10 seconds');
  });

  it('survives a body that is not JSON', async () => {
    const failure = await failureFromResponse(new Response('<html>bad gateway</html>', { status: 502 }));
    expect(failure.status).toBe(502);
    expect(failure.body).toBeUndefined();
  });
});
