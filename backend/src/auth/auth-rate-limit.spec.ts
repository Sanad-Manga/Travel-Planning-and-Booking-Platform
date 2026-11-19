import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthRateLimitGuard, AuthRateLimited, AuthRateLimiter } from './auth-rate-limit';

describe('AuthRateLimiter (ACC-07 review)', () => {
  const config = { limit: 3, windowMs: 60_000 };

  it('allows up to the limit, then blocks with the seconds left in the window', () => {
    const limiter = new AuthRateLimiter(config);
    for (let i = 0; i < 3; i++) expect(limiter.hit('forgot-password', '1.1.1.1', 1000).allowed).toBe(true);
    const blocked = limiter.hit('forgot-password', '1.1.1.1', 1000 + 10_000);
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 50 });
  });

  it('starts a new window after windowMs', () => {
    const limiter = new AuthRateLimiter(config);
    for (let i = 0; i < 4; i++) limiter.hit('r', 'ip', 0);
    expect(limiter.hit('r', 'ip', 59_999).allowed).toBe(false);
    expect(limiter.hit('r', 'ip', 60_000).allowed).toBe(true);
  });

  it('keeps separate counters per route and per IP', () => {
    const limiter = new AuthRateLimiter(config);
    for (let i = 0; i < 3; i++) limiter.hit('forgot-password', 'ip', 0);
    expect(limiter.hit('forgot-password', 'ip', 0).allowed).toBe(false);
    expect(limiter.hit('reset-password', 'ip', 0).allowed).toBe(true);
    expect(limiter.hit('forgot-password', 'other', 0).allowed).toBe(true);
  });

  it('purges expired keys so memory does not grow without bound', () => {
    const limiter = new AuthRateLimiter(config);
    for (let i = 0; i < 100; i++) limiter.hit('r', `ip${i}`, 0);
    expect(limiter.size).toBe(100);
    limiter.hit('r', 'late', 120_000); // past every window and past the purge interval
    expect(limiter.size).toBe(1);
  });

  it('defaults to 10 requests per 15 minutes', () => {
    const limiter = new AuthRateLimiter();
    for (let i = 0; i < 10; i++) expect(limiter.hit('r', 'ip', 0).allowed).toBe(true);
    expect(limiter.hit('r', 'ip', 0)).toEqual({ allowed: false, retryAfterSeconds: 900 });
  });
});

describe('AuthRateLimitGuard', () => {
  class Handlers {
    @AuthRateLimited('forgot-password')
    limited(): void {}
    unmarked(): void {}
  }
  const setHeader = jest.fn();
  const ctx = (handler: () => void, ip = '1.1.1.1') =>
    ({
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({ ip }), getResponse: () => ({ setHeader }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => setHeader.mockClear());

  it('answers 429 with a Retry-After header once the limit is passed', () => {
    const guard = new AuthRateLimitGuard(new AuthRateLimiter({ limit: 1, windowMs: 60_000 }), new Reflector());
    expect(guard.canActivate(ctx(Handlers.prototype.limited))).toBe(true);
    let error: HttpException | undefined;
    try {
      guard.canActivate(ctx(Handlers.prototype.limited));
    } catch (e) {
      error = e as HttpException;
    }
    expect(error?.getStatus()).toBe(429);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
  });

  it('ignores a handler without the marker', () => {
    const guard = new AuthRateLimitGuard(new AuthRateLimiter({ limit: 1, windowMs: 60_000 }), new Reflector());
    for (let i = 0; i < 5; i++) expect(guard.canActivate(ctx(Handlers.prototype.unmarked))).toBe(true);
  });
});
