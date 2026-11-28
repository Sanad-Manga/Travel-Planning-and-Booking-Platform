import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/components/AuthProvider';
import AdminLayout from './layout';

let path = '/admin';
let auth: { user: Pick<AuthUser, 'id' | 'role' | 'mustChangePassword'> | null; loading: boolean };
const router = { replace: vi.fn() };
vi.mock('next/navigation', () => ({ usePathname: () => path, useRouter: () => router }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => auth }));

function mount() {
  return render(<AdminLayout><h1>Protected admin page</h1></AdminLayout>);
}

beforeEach(() => {
  path = '/admin';
  auth = { user: { id: 'admin', role: 'ADMIN' }, loading: false };
  router.replace.mockClear();
});

it('renders shared navigation, nested content and keyboard-accessible links for admins', async () => {
  const keyboard = userEvent.setup();
  mount();
  const nav = within(screen.getByRole('navigation', { name: 'Admin navigation' }));
  expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/admin');
  expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  expect(nav.getByRole('link', { name: 'Create moderator' })).toHaveAttribute('href', '/admin/moderators/new');
  for (const label of ['Accounts', 'Providers', 'Bookings', 'Reports', 'Audit logs', 'Analytics']) {
    expect(nav.getByText(label)).toHaveTextContent(`${label} Coming soon`);
    expect(nav.queryByRole('link', { name: label })).toBeNull();
  }
  expect(screen.getByRole('heading', { name: 'Protected admin page' })).toBeVisible();
  await keyboard.tab();
  expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveFocus();
  await keyboard.tab();
  expect(nav.getByRole('link', { name: 'Create moderator' })).toHaveFocus();
});

it.each(['/admin/moderators/new', '/admin/moderators/new/example'])('highlights only the management section for %s', (route) => {
  path = route;
  mount();
  const nav = within(screen.getByRole('navigation', { name: 'Admin navigation' }));
  expect(nav.getByRole('link', { name: 'Create moderator' })).toHaveAttribute('aria-current', 'page');
  expect(nav.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
});

it.each(['USER', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR'] as const)('rejects %s before protected navigation or nested content renders', (role) => {
  auth.user = { id: 'visitor', role };
  mount();
  expect(screen.queryByRole('navigation', { name: 'Admin navigation' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Protected admin page' })).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this page');
});

it('hides the shell for guests and keeps the login returnTo', () => {
  path = '/admin/moderators/new';
  auth.user = null;
  mount();
  expect(screen.queryByRole('navigation', { name: 'Admin navigation' })).toBeNull();
  expect(router.replace).toHaveBeenCalledWith('/login?returnTo=%2Fadmin%2Fmoderators%2Fnew');
});

it('hides the shell while authentication is loading', () => {
  auth = { user: null, loading: true };
  mount();
  expect(screen.queryByRole('heading', { name: 'Protected admin page' })).toBeNull();
  expect(router.replace).not.toHaveBeenCalled();
});

it('preserves forced-password-change navigation', () => {
  auth.user = { id: 'admin', role: 'ADMIN', mustChangePassword: true };
  mount();
  expect(screen.queryByRole('navigation', { name: 'Admin navigation' })).toBeNull();
  expect(router.replace).toHaveBeenCalledWith('/change-password');
});
