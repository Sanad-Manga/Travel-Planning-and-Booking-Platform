import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPendingAction } from '@/lib/pendingAction';
import { RequireAuth } from './RequireAuth';

const replace = vi.fn();
let pathname = '/trips';
let auth: { user: { id: string; mustChangePassword?: boolean } | null; loading: boolean } = { user: null, loading: false };

vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ replace }) }));
vi.mock('./AuthProvider', () => ({ useAuth: () => auth }));

beforeEach(() => {
  replace.mockReset();
  sessionStorage.clear();
  pathname = '/trips';
  auth = { user: null, loading: false };
  window.history.replaceState(null, '', '/trips?id=5');
});

describe('RequireAuth (ACC-10)', () => {
  it('shows the page to a logged-in user and does not redirect', () => {
    auth = { user: { id: 'u1' }, loading: false };
    render(
      <RequireAuth>
        <p>Secret page</p>
      </RequireAuth>,
    );
    expect(screen.getByText('Secret page')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('while the session is being checked it shows a spinner, not the page, and does not redirect yet', () => {
    auth = { user: null, loading: true };
    render(
      <RequireAuth>
        <p>Secret page</p>
      </RequireAuth>,
    );
    expect(screen.queryByText('Secret page')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/checking/i);
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends a guest to /login with the current path and query as returnTo', async () => {
    render(
      <RequireAuth>
        <p>Secret page</p>
      </RequireAuth>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?returnTo=%2Ftrips%3Fid%3D5'));
    expect(screen.queryByText('Secret page')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/sign/i);
  });

  it('works for a path without a query', async () => {
    window.history.replaceState(null, '', '/account');
    pathname = '/account';
    render(
      <RequireAuth>
        <p>x</p>
      </RequireAuth>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?returnTo=%2Faccount'));
  });

  it('remembers the action name and path (and nothing else) to resume after login', async () => {
    render(
      <RequireAuth action="book-room">
        <p>x</p>
      </RequireAuth>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(readPendingAction()).toEqual({ path: '/trips?id=5', action: 'book-room' });
    expect(localStorage.length).toBe(0);
  });

  it('does not touch storage for a logged-in user', () => {
    auth = { user: { id: 'u1' }, loading: false };
    render(
      <RequireAuth action="book-room">
        <p>x</p>
      </RequireAuth>,
    );
    expect(readPendingAction()).toBeNull();
  });

  describe('forced password change (ACC-11)', () => {
    it('sends a user with a temporary password to /change-password and hides the page', async () => {
      auth = { user: { id: 'u1', mustChangePassword: true }, loading: false };
      render(
        <RequireAuth>
          <p>Secret page</p>
        </RequireAuth>,
      );
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/change-password'));
      expect(screen.queryByText('Secret page')).toBeNull();
    });

    it('allowMustChange lets that user see the page (the change-password page itself)', () => {
      auth = { user: { id: 'u1', mustChangePassword: true }, loading: false };
      render(
        <RequireAuth allowMustChange>
          <p>Change form</p>
        </RequireAuth>,
      );
      expect(screen.getByText('Change form')).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });

    it('resumeAfterLogin={false} sends a guest to plain /login and remembers nothing', async () => {
      render(
        <RequireAuth allowMustChange resumeAfterLogin={false}>
          <p>x</p>
        </RequireAuth>,
      );
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
      expect(readPendingAction()).toBeNull();
    });
  });
});
