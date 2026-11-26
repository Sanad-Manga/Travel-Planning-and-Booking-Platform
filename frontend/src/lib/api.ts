import { loginUrl } from './returnTo';

/**
 * ACC-10: the one way the frontend talks to the backend. Same-origin `/api/*` (proxied by Next, see
 * next.config.ts) with `credentials: 'include'`, so the httpOnly auth cookies travel with every request
 * and no token is ever visible to JavaScript.
 *
 * On a 401 it asks `POST /api/auth/refresh` for a new session ONCE and retries the request ONCE. If that
 * does not help, the user is sent to the login page with `returnTo` so they come back to where they were.
 */

export interface ApiErrorDetail {
  field: string;
  message: string;
}

/** The backend error shape: { statusCode, error, message, details?, path, timestamp }. */
export class ApiError extends Error {
  readonly statusCode: number;
  /** Same as `statusCode`; lets an ApiError be passed straight to `toFriendlyError`. */
  readonly status: number;
  readonly details: ApiErrorDetail[];
  /** The raw Retry-After header (seconds or an HTTP date), when the server sent one. */
  readonly retryAfter: string | null;
  /** The parsed JSON body, for `toFriendlyError`. */
  readonly body: unknown;

  constructor(statusCode: number, message: string, details: ApiErrorDetail[] = [], retryAfter: string | null = null, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.status = statusCode;
    this.details = details;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** FormData passes through as multipart. Other values are sent as JSON. */
  body?: unknown;
  signal?: AbortSignal;
  /** On a 401, refresh the session and retry once (default true). Off for login, where 401 means wrong password. */
  retryOn401?: boolean;
  /** When the request is still 401, send the user to the login page (default true). Off for the "who am I?" check. */
  redirectOn401?: boolean;
}

type UnauthorizedHandler = (returnTo: string) => void;

function defaultUnauthorizedHandler(returnTo: string): void {
  window.location.assign(loginUrl(returnTo));
}

let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Replace what happens on a lost session (tests, or a router-based redirect). `null` restores the default. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname === '/login' || pathname.startsWith('/login/')) return; // already there: no loop
  (unauthorizedHandler ?? defaultUnauthorizedHandler)(`${pathname}${search}`);
}

function url(path: string): string {
  return path.startsWith('/api/') || path === '/api' ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Turns a failed response into an ApiError (also used by the server-side helper, GEN-17). */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const message = isRecord(body) && typeof body.message === 'string' && body.message ? body.message : `Request failed (${response.status})`;
  const details: ApiErrorDetail[] = [];
  if (isRecord(body) && Array.isArray(body.details)) {
    for (const entry of body.details) {
      if (isRecord(entry) && typeof entry.field === 'string' && typeof entry.message === 'string') {
        details.push({ field: entry.field, message: entry.message });
      }
    }
  }
  return new ApiError(response.status, message, details, response.headers.get('Retry-After'), body);
}

function send(path: string, { method = 'GET', body, signal }: ApiOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isMultipart) headers['Content-Type'] = 'application/json';
  return fetch(url(path), {
    method,
    credentials: 'include',
    headers,
    body: isMultipart ? body : JSON.stringify(body),
    signal,
  });
}

// Refresh tokens rotate and are single use, so requests that fail together must share ONE refresh call.
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { retryOn401 = true, redirectOn401 = true } = options;
  let response = await send(path, options);

  if (response.status === 401 && retryOn401 && url(path) !== '/api/auth/refresh') {
    if (await refreshSession()) {
      response = await send(path, options); // the one retry
    }
    if (response.status === 401 && redirectOn401) redirectToLogin();
  } else if (response.status === 401 && redirectOn401 && url(path) !== '/api/auth/refresh') {
    redirectToLogin();
  }

  if (!response.ok) throw await toApiError(response);
  return parse<T>(response);
}
