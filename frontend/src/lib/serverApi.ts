import { cookies } from 'next/headers';
import { toApiError } from './api';

/**
 * GEN-17: read backend data while rendering a SERVER component (page.tsx without 'use client').
 *
 * The server calls the NestJS API directly (BACKEND_URL, the same value next.config.ts proxies to) and
 * forwards ONLY the user's `access_token` cookie, so the backend sees the same user as the browser would.
 * The refresh token is never forwarded: a server component cannot set the rotated cookies, so it never
 * refreshes. Responses are never cached, because they are per user.
 *
 * - 2xx: `{ ok: true, data }`
 * - 401 (no session, or the access token expired): `{ ok: false, reason: 'unauthorized' }`. Render a client
 *   component that loads the same data with `useApi`: in the browser `api()` refreshes the session once and
 *   sends the user to login if that fails. See src/app/examples/server-fetch.
 * - anything else: throws an `ApiError` (shown by the nearest error.tsx / error boundary).
 *
 * Only import this from server components or route handlers: `next/headers` does not exist in the browser.
 */
export type ServerResult<T> = { ok: true; data: T } | { ok: false; reason: 'unauthorized' };

function backendUrl(path: string): string {
  const base = (process.env.BACKEND_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
  const apiPath = path.startsWith('/api/') || path === '/api' ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
  return `${base}${apiPath}`;
}

export async function serverApi<T = unknown>(path: string): Promise<ServerResult<T>> {
  const access = (await cookies()).get('access_token');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (access) headers.Cookie = `access_token=${access.value}`;

  const response = await fetch(backendUrl(path), { method: 'GET', headers, cache: 'no-store' });
  if (response.status === 401) return { ok: false, reason: 'unauthorized' };
  if (!response.ok) throw await toApiError(response);
  const text = await response.text();
  return { ok: true, data: (text ? JSON.parse(text) : undefined) as T };
}
