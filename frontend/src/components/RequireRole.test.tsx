import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';
import { RequireRole } from './RequireRole';

const replace = vi.fn();
let pathname = '/admin';
type TestUser = { id: string; role: Role; mustChangePassword?: boolean };
let auth: { user: TestUser | null; loading: boolean } = { user: null, loading: false };

vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ replace }) }));
vi.mock('./AuthProvider', () => ({ useAuth: () => auth }));

beforeEach(() => {
  replace.mockReset();
  sessionStorage.clear();
  pathname = '/admin';
  auth = { user: null, loading: false };
  window.history.replaceState(null, '', '/admin');
});

function page() {
  return (
    <RequireRole roles={['ADMIN']}>
      <p>Admin only</p>
    </RequireRole>
  );
}

describe('RequireRole (ACC-04)', () => {
  it('shows the page to a user with an allowed role', () => {
    auth = { user: { id: 'u', role: 'ADMIN' }, loading: false };
    render(page());
    expect(screen.getByText('Admin only')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows nothing of the page while the session is being checked', () => {
    auth = { user: null, loading: true };
    render(page());
    expect(screen.queryByText('Admin only')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends a guest to login with returnTo', async () => {
    render(page());
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?returnTo=%2Fadmin'));
    expect(screen.queryByText('Admin only')).toBeNull();
  });

  it('tells a user with the wrong role so, hides the page and links to their home', () => {
    auth = { user: { id: 'u', role: 'AIRLINE_MODERATOR' }, loading: false };
    render(page());
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this page');
    expect(screen.queryByText('Admin only')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to your home' })).toHaveAttribute('href', '/airline');
    expect(replace).not.toHaveBeenCalled();
  });

  it('a plain USER is sent home to "/"', () => {
    auth = { user: { id: 'u', role: 'USER' }, loading: false };
    render(page());
    expect(screen.getByRole('link', { name: 'Go to your home' })).toHaveAttribute('href', '/');
  });

  it('a user who must change their password goes to /change-password, and sees nothing of the page', async () => {
    auth = { user: { id: 'u', role: 'ADMIN', mustChangePassword: true }, loading: false };
    render(page());
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/change-password'));
    expect(screen.queryByText('Admin only')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a forced user with the wrong role is still sent to /change-password, not shown the access message', async () => {
    auth = { user: { id: 'u', role: 'USER', mustChangePassword: true }, loading: false };
    render(page());
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/change-password'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
