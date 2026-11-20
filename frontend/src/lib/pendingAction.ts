import { safeReturnTo } from './returnTo';

/**
 * ACC-10: a guest who clicks "Book now" is sent to log in and then brought back. To resume the action we
 * remember WHERE they were and WHICH action, as a short identifier ("book-room"), in sessionStorage.
 * Never put tokens, passwords, form contents or personal data here (contracts.md section 4): the
 * session lives only in the httpOnly cookies. The destination page re-reads what it needs from the API.
 */

const KEY = 'pendingAction';
const ACTION_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

export interface PendingAction {
  /** A same-site path (with query) to return to. */
  path: string;
  /** A short action identifier such as "book-room" or "like-post". */
  action?: string;
}

export function rememberPendingAction({ path, action }: PendingAction): void {
  const safePath = safeReturnTo(path);
  if (safePath === '/' && path !== '/') return; // unsafe path: remember nothing
  if (action !== undefined && !ACTION_NAME.test(action)) return;
  try {
    const value: PendingAction = action === undefined ? { path: safePath } : { path: safePath, action };
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // sessionStorage can be blocked (private windows); the returnTo in the URL still works.
  }
}

export function readPendingAction(): PendingAction | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const { path, action } = parsed as Record<string, unknown>;
    if (typeof path !== 'string') return null;
    const safePath = safeReturnTo(path);
    if (safePath === '/' && path !== '/') return null;
    if (action === undefined) return { path: safePath };
    if (typeof action !== 'string' || !ACTION_NAME.test(action)) return null;
    // Only these two fields are ever read back, whatever else was written.
    return { path: safePath, action };
  } catch {
    return null;
  }
}

export function clearPendingAction(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** For the page the user returns to: the pending action name if it was for this path (then forgotten). */
export function takePendingAction(path: string): string | null {
  const pending = readPendingAction();
  if (!pending || pending.path !== path || !pending.action) return null;
  clearPendingAction();
  return pending.action;
}
