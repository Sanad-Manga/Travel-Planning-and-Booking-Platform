import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPendingAction, readPendingAction, rememberPendingAction, takePendingAction } from './pendingAction';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('pendingAction (ACC-10)', () => {
  it('remembers a path and an action name, and nothing else', () => {
    rememberPendingAction({ path: '/hotels/1?room=2', action: 'book-room' });
    expect(sessionStorage.length).toBe(1);
    const raw = sessionStorage.getItem(sessionStorage.key(0) as string) as string;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['action', 'path']);
    expect(localStorage.length).toBe(0);
  });

  it('reads it back', () => {
    rememberPendingAction({ path: '/blog/posts/1', action: 'like-post' });
    expect(readPendingAction()).toEqual({ path: '/blog/posts/1', action: 'like-post' });
  });

  it('works without an action name', () => {
    rememberPendingAction({ path: '/itineraries' });
    expect(readPendingAction()).toEqual({ path: '/itineraries' });
  });

  it('takePendingAction returns the action only for the matching path, and clears it', () => {
    rememberPendingAction({ path: '/blog/posts/1', action: 'like-post' });
    expect(takePendingAction('/flights')).toBeNull();
    expect(readPendingAction()).not.toBeNull();
    expect(takePendingAction('/blog/posts/1')).toBe('like-post');
    expect(readPendingAction()).toBeNull();
  });

  it('refuses an unsafe path when remembering', () => {
    rememberPendingAction({ path: '//evil.com', action: 'x' });
    expect(readPendingAction()).toBeNull();
  });

  it('refuses an action name that is not a plain identifier (no free text, no personal data)', () => {
    rememberPendingAction({ path: '/ok', action: 'book for ziad@example.com' });
    expect(readPendingAction()).toBeNull();
    rememberPendingAction({ path: '/ok', action: 'a'.repeat(65) });
    expect(readPendingAction()).toBeNull();
  });

  it('ignores stored data that was tampered with', () => {
    sessionStorage.setItem('pendingAction', '{not json');
    expect(readPendingAction()).toBeNull();
    sessionStorage.setItem('pendingAction', JSON.stringify({ path: 'https://evil.com', action: 'x' }));
    expect(readPendingAction()).toBeNull();
    sessionStorage.setItem('pendingAction', JSON.stringify({ path: '/ok', action: 'x', token: 'secret' }));
    expect(readPendingAction()).toEqual({ path: '/ok', action: 'x' });
    sessionStorage.setItem('pendingAction', JSON.stringify(['/ok']));
    expect(readPendingAction()).toBeNull();
  });

  it('clearPendingAction removes it', () => {
    rememberPendingAction({ path: '/ok', action: 'x' });
    clearPendingAction();
    expect(readPendingAction()).toBeNull();
  });

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => rememberPendingAction({ path: '/ok', action: 'x' })).not.toThrow();
    expect(readPendingAction()).toBeNull();
    expect(takePendingAction('/ok')).toBeNull();
  });
});
