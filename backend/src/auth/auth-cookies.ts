import { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, SESSION_INACTIVITY_MINUTES } from '../common';

/** Access tokens live 15 minutes (the cookie expires at the same time as the token inside it). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Refresh tokens live as long as the allowed inactivity (30 minutes, contracts.md section 6). */
export const REFRESH_TOKEN_TTL_SECONDS = SESSION_INACTIVITY_MINUTES * 60;

/**
 * The one place that decides cookie flags, so every auth cookie is set the same way:
 * - httpOnly: JavaScript in the browser cannot read the token (protects against XSS theft)
 * - secure: only sent over HTTPS (false in local dev over http, true in production via COOKIE_SECURE)
 * - sameSite lax: not sent on cross-site POSTs, which blocks most CSRF while normal navigation still works
 */
const baseOptions = (secure: boolean): CookieOptions => ({ httpOnly: true, secure, sameSite: 'lax' });

/** Sent with every request (path /) so the global guard can read it on any route. */
export function accessCookieOptions(secure: boolean): CookieOptions {
  return { ...baseOptions(secure), path: '/', maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 };
}

/** Only sent to /api/auth/*, so the long-lived token is not attached to ordinary API calls. */
export function refreshCookieOptions(secure: boolean): CookieOptions {
  return { ...baseOptions(secure), path: '/api/auth', maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000 };
}

/**
 * Removes both cookies. A browser only deletes a cookie when the name, path (and flags) match the one it holds,
 * so this reuses the exact same option builders as setAuthCookies; the options cannot drift apart.
 */
export function clearAuthCookies(res: Response, secure: boolean): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, withoutMaxAge(accessCookieOptions(secure)));
  res.clearCookie(REFRESH_TOKEN_COOKIE, withoutMaxAge(refreshCookieOptions(secure)));
}

// Clearing sets an already-expired date, so maxAge must not be passed along.
function withoutMaxAge(options: CookieOptions): CookieOptions {
  const copy = { ...options };
  delete copy.maxAge;
  return copy;
}

export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }, secure: boolean): void {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, accessCookieOptions(secure));
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, refreshCookieOptions(secure));
}
