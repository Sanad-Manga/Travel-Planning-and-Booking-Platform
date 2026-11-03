import { Response } from 'express';
import { accessCookieOptions, clearAuthCookies, refreshCookieOptions, setAuthCookies } from './auth-cookies';

describe('auth cookies helpers', () => {
  const res = { cookie: jest.fn(), clearCookie: jest.fn() };
  const asResponse = res as unknown as Response;

  beforeEach(() => jest.resetAllMocks());

  it.each([false, true])('clearAuthCookies uses the same path and flags as setAuthCookies (secure=%s)', (secure) => {
    setAuthCookies(asResponse, { accessToken: 'a', refreshToken: 'r' }, secure);
    clearAuthCookies(asResponse, secure);

    const setOptions = Object.fromEntries(res.cookie.mock.calls.map(([name, , options]) => [name, options]));
    const clearOptions = Object.fromEntries(res.clearCookie.mock.calls.map(([name, options]) => [name, options]));
    expect(Object.keys(clearOptions).sort()).toEqual(['access_token', 'refresh_token']);
    for (const name of ['access_token', 'refresh_token']) {
      const { maxAge, ...expected } = setOptions[name];
      expect(maxAge).toBeGreaterThan(0);
      expect(clearOptions[name]).toEqual(expected); // identical path, httpOnly, secure and sameSite
    }
  });

  it('keeps the documented paths and lifetimes', () => {
    expect(accessCookieOptions(false)).toMatchObject({ path: '/', maxAge: 15 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
    expect(refreshCookieOptions(true)).toMatchObject({ path: '/api/auth', maxAge: 30 * 60 * 1000, httpOnly: true, secure: true });
  });
});
