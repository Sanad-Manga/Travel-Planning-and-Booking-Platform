import { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_COOKIE } from '../common';

/** Access tokens live 15 minutes (the cookie expires at the same time as the token inside it). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * The one place that decides cookie flags, so every auth cookie is set the same way:
 * - httpOnly: JavaScript in the browser cannot read the token (protects against XSS theft)
 * - secure: only sent over HTTPS (false in local dev over http, true in production via COOKIE_SECURE)
 * - sameSite lax: not sent on cross-site POSTs, which blocks most CSRF while normal navigation still works
 */
export function accessCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 };
}

export function setAccessCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, accessCookieOptions(secure));
}
