import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForcedPasswordRedirect } from './ForcedPasswordRedirect';

const replace = vi.fn();
let pathname = '/';
let auth: { user: { mustChangePassword?: boolean } | null; loading: boolean } = { user: null, loading: false };
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ replace }) }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => auth }));

beforeEach(() => {
  replace.mockReset();
  pathname = '/';
  auth = { user: null, loading: false };
});

describe('ForcedPasswordRedirect (ACC-13, ACC-07a)', () => {
  it.each(['/', '/flights', '/blog/some-post', '/account'])('sends a user with a temporary password from %s to /change-password', (path) => {
    pathname = path;
    auth = { user: { mustChangePassword: true }, loading: false };
    render(<ForcedPasswordRedirect />);
    expect(replace).toHaveBeenCalledWith('/change-password');
  });

  it('leaves them on /change-password itself', () => {
    pathname = '/change-password';
    auth = { user: { mustChangePassword: true }, loading: false };
    render(<ForcedPasswordRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });

  it('does nothing for guests and for users without a temporary password', () => {
    const { rerender } = render(<ForcedPasswordRedirect />);
    auth = { user: { mustChangePassword: false }, loading: false };
    rerender(<ForcedPasswordRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });
});
