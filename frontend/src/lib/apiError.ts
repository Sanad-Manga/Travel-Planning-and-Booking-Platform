/**
 * GEN-16: turns whatever a failed request produced into something a person can act on.
 *
 * The backend answers every error with
 *   { statusCode, error, message, details?: [{ field, message }], path, timestamp }
 * (contracts section 3). Callers collect the status, the parsed body and the Retry-After header into an
 * `ApiFailure` (see `failureFromResponse`) and pass it, or a thrown fetch error, to `toFriendlyError`.
 */

export interface ApiFailure {
  status?: number;
  /** The parsed JSON error body, when the server sent one. */
  body?: unknown;
  /** The raw Retry-After header: delta-seconds or an HTTP date. */
  retryAfter?: string | number | null;
}

export interface FriendlyError {
  /** One plain sentence saying what went wrong. */
  message: string;
  /** One plain sentence saying what to do next. */
  hint: string;
  /** Server validation messages by field name (first message per field), for TextField `error`. */
  fieldErrors: Record<string, string>;
  /** True when trying the same thing again might work, so the UI can offer "Try again". */
  retryable: boolean;
  status?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function bodyMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const { message } = body;
  if (typeof message === 'string' && message.trim()) return message.trim();
  // Nest can send an array of messages from its own pipes; join them rather than show "[object Object]".
  if (Array.isArray(message)) {
    const parts = message.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
    if (parts.length) return parts.join(' ');
  }
  return undefined;
}

function fieldErrorsFrom(body: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(body) || !Array.isArray(body.details)) return result;
  for (const entry of body.details) {
    if (!isRecord(entry)) continue;
    const { field, message } = entry;
    if (typeof field !== 'string' || typeof message !== 'string' || !field || !message) continue;
    if (!(field in result)) result[field] = message;
  }
  return result;
}

function waitSeconds(retryAfter: string | number | null | undefined, now: number): number | undefined {
  if (retryAfter === null || retryAfter === undefined || retryAfter === '') return undefined;
  if (typeof retryAfter === 'number') return Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined;
  const text = retryAfter.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return seconds > 0 ? seconds : undefined;
  }
  const date = Date.parse(text);
  if (Number.isNaN(date)) return undefined;
  const seconds = Math.ceil((date - now) / 1000);
  return seconds > 0 ? seconds : undefined;
}

function describeWait(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

function isApiFailure(input: unknown): input is ApiFailure {
  return isRecord(input) && typeof input.status === 'number';
}

/** `now` is injectable so a Retry-After date can be tested. */
export function toFriendlyError(input: unknown, now: number = Date.now()): FriendlyError {
  const generic: FriendlyError = {
    message: 'Something went wrong.',
    hint: 'Please try again. If it keeps happening, contact support.',
    fieldErrors: {},
    retryable: true,
  };

  if (!isApiFailure(input)) {
    // fetch() rejects with a TypeError when there is no connection, a DNS failure or a CORS block.
    if (input instanceof TypeError) {
      return {
        message: 'We couldn’t reach the server.',
        hint: 'Check your internet connection and try again.',
        fieldErrors: {},
        retryable: true,
      };
    }
    return generic;
  }

  const { status, body } = input;
  const serverMessage = bodyMessage(body);

  if (status === 400) {
    const fieldErrors = fieldErrorsFrom(body);
    if (Object.keys(fieldErrors).length > 0) {
      return {
        message: 'Some details need fixing.',
        hint: 'Fix the highlighted fields and submit again.',
        fieldErrors,
        retryable: false,
        status,
      };
    }
    return {
      message: serverMessage && serverMessage !== 'Validation failed' ? serverMessage : 'Some of the information you entered isn’t valid.',
      hint: 'Check what you entered and try again.',
      fieldErrors,
      retryable: false,
      status,
    };
  }

  if (status === 401) {
    return {
      message: 'You’re signed out, or your session has ended.',
      hint: 'Sign in again to continue.',
      fieldErrors: {},
      retryable: false,
      status,
    };
  }

  if (status === 403) {
    return {
      message: 'You don’t have permission to do that.',
      hint: 'If you think this is a mistake, sign in with a different account or contact support.',
      fieldErrors: {},
      retryable: false,
      status,
    };
  }

  if (status === 404) {
    return {
      message: 'We couldn’t find what you were looking for.',
      hint: 'It may have been moved or removed. Go back and check the link.',
      fieldErrors: {},
      retryable: false,
      status,
    };
  }

  if (status === 409) {
    return {
      // The server's reason (sold out, dates overlap, already exists) is the useful part here.
      message: serverMessage ?? 'This has changed since you last looked, so it can’t be completed.',
      hint: 'Refresh the page, change your selection and try again.',
      fieldErrors: {},
      retryable: false,
      status,
    };
  }

  if (status === 429) {
    const seconds = waitSeconds(input.retryAfter, now);
    return {
      message: 'Too many requests.',
      hint: seconds ? `Please try again in ${describeWait(seconds)}.` : 'Please wait a moment and try again.',
      fieldErrors: {},
      retryable: true,
      status,
    };
  }

  if (typeof status === 'number' && status >= 500 && status < 600) {
    // Never show server text for a 5xx: it can carry internals.
    return {
      message: 'Something went wrong on our side.',
      hint: 'Please try again in a moment. Your information has not been lost.',
      fieldErrors: {},
      retryable: true,
      status,
    };
  }

  return { ...generic, status };
}

/** Reads the status, JSON body (if any) and Retry-After header of a failed fetch Response. */
export async function failureFromResponse(response: Response): Promise<ApiFailure> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, body, retryAfter: response.headers.get('Retry-After') };
}
