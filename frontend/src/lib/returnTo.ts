/**
 * ACC-10: where to send someone after they log in. The value comes from the URL (`/login?returnTo=...`),
 * so it is attacker-controlled: an unchecked redirect would be an open redirect (phishing).
 */

const MAX_LENGTH = 2048;
const MAX_DECODE_ROUNDS = 5;
// C0 and C1 controls (includes tab, CR, LF, NUL, DEL) and the Unicode line/paragraph separators.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const PLACEHOLDER_ORIGIN = 'http://same-site.invalid';

/** Decodes every valid %XX run, and leaves malformed escapes as they are (browsers do the same). */
function decodeOnce(value: string): string {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/** One string, as it would be read after this many decodings: is it a same-site path? */
function looksSafe(candidate: string): boolean {
  if (!candidate.startsWith('/')) return false; // a scheme ("https:", "javascript:") or a bare host
  if (candidate.startsWith('//')) return false; // protocol-relative: "//evil.com"
  if (candidate.includes('\\')) return false; // browsers treat "\" as "/": "/\evil.com"
  if (CONTROL_CHARACTERS.test(candidate)) return false; // tabs and newlines are stripped by URL parsers
  return true;
}

/**
 * Returns `value` only if it is a same-site path starting with a single "/", otherwise "/".
 * It is checked as given AND after every layer of percent-decoding, so "/%5Cevil.com" and
 * "%2F%2Fevil.com" fail just like "/\evil.com" and "//evil.com". The original string is returned
 * unchanged (never the decoded one). The login page itself is not a valid destination.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return '/';

  let current = value;
  for (let round = 0; ; round++) {
    if (!looksSafe(current)) return '/';
    const decoded = decodeOnce(current);
    if (decoded === current) break;
    if (round >= MAX_DECODE_ROUNDS) return '/'; // still changing after many layers: not a real path
    current = decoded;
  }

  // Last line of defence: a URL parser must agree that this stays on our own origin.
  try {
    if (new URL(value, PLACEHOLDER_ORIGIN).origin !== PLACEHOLDER_ORIGIN) return '/';
  } catch {
    return '/';
  }

  const path = value.split(/[?#]/)[0];
  if (path === '/login' || path.startsWith('/login/')) return '/';
  return value;
}

/** `/login?returnTo=<encoded path>`; the parameter is left out when the path is the default "/". */
export function loginUrl(returnTo?: string): string {
  const safe = safeReturnTo(returnTo);
  return safe === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(safe)}`;
}
