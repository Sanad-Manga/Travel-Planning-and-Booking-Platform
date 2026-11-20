import { describe, expect, it } from 'vitest';
import { loginUrl, safeReturnTo } from './returnTo';

describe('safeReturnTo (ACC-10)', () => {
  it.each([
    '/',
    '/flights',
    '/flights?from=CAI&to=LHR',
    '/hotels/abc123',
    '/blog/posts/1#comments',
    '/search?q=100%25',
    '/hotels?name=caf%C3%A9',
    '/@someone',
    '/a//b',
  ])('accepts the same-site path %s unchanged', (value) => {
    expect(safeReturnTo(value)).toBe(value);
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with path', '//evil.com/login'],
    ['triple slash', '///evil.com'],
    ['https URL', 'https://evil.com'],
    ['http URL with path', 'http://evil.com/x'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['JaVaScRiPt scheme', 'JaVaScRiPt:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['mailto', 'mailto:a@b.com'],
    ['bare host', 'evil.com'],
    ['bare host with path', 'evil.com/path'],
    ['slash backslash', '/\\evil.com'],
    ['double backslash', '\\\\evil.com'],
    ['backslash inside the path', '/ok\\evil.com'],
    ['leading space then //', ' //evil.com'],
    ['leading space', ' /ok'],
    ['tab inside', '/\t/evil.com'],
    ['newline inside', '/\n/evil.com'],
    ['carriage return', '/\r/evil.com'],
    ['null byte', '/\u0000evil'],
    ['C1 control character', '/\u0085/evil.com'],
    ['unicode line separator', '/\u2028/evil.com'],
    ['DEL character', '/\u007f'],
    ['empty string', ''],
    ['only whitespace', '   '],
    ['encoded slash slash', '%2F%2Fevil.com'],
    ['encoded slash after slash', '/%2Fevil.com'],
    ['encoded backslash', '/%5Cevil.com'],
    ['lowercase encoded backslash', '/%5cevil.com'],
    ['encoded tab', '/%09/evil.com'],
    ['encoded newline', '/%0a/evil.com'],
    ['encoded CRLF header injection', '/%0d%0aSet-Cookie:x=1'],
    ['encoded null', '/%00'],
    ['double-encoded slash', '/%252Fevil.com'],
    ['double-encoded backslash', '/%255Cevil.com'],
    ['triple-encoded slash', '/%25252Fevil.com'],
    ['encoded scheme', '%68ttps://evil.com'],
    ['encoded // at the very start', '/%2f/evil.com'],
    ['mixed encoded and malformed escape', '/%2F%2Fevil%'],
  ])('rejects %s', (_name, value) => {
    expect(safeReturnTo(value)).toBe('/');
  });

  it('rejects a value that is still being decoded after many layers', () => {
    // "/A" encoded 7 times: harmless in the end, but nobody legitimate nests that deep.
    let nested = '/%41';
    for (let i = 0; i < 7; i++) nested = nested.replace(/%/g, '%25');
    expect(safeReturnTo(nested)).toBe('/');
  });

  it('rejects very long values', () => {
    expect(safeReturnTo(`/${'a'.repeat(3000)}`)).toBe('/');
  });

  it.each([null, undefined, 42, {}, [], ['/ok'], true])('falls back to "/" for the non-string %s', (value) => {
    expect(safeReturnTo(value)).toBe('/');
  });

  it('does not send people back to the login page', () => {
    expect(safeReturnTo('/login')).toBe('/');
    expect(safeReturnTo('/login?returnTo=%2Fflights')).toBe('/');
    expect(safeReturnTo('/login/')).toBe('/');
  });

  it('still accepts paths that merely start like login', () => {
    expect(safeReturnTo('/login-help')).toBe('/login-help');
  });

  it('returns the original string, not a decoded one', () => {
    expect(safeReturnTo('/hotels?name=caf%C3%A9')).toBe('/hotels?name=caf%C3%A9');
  });
});

describe('loginUrl', () => {
  it('carries a safe return path, encoded', () => {
    expect(loginUrl('/trips?id=5')).toBe('/login?returnTo=%2Ftrips%3Fid%3D5');
  });

  it('drops an unsafe or default return path', () => {
    expect(loginUrl('//evil.com')).toBe('/login');
    expect(loginUrl('/')).toBe('/login');
    expect(loginUrl(undefined)).toBe('/login');
  });
});
