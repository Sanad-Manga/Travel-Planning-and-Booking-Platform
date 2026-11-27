import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { SkipLink } from './SkipLink';

let pathname = '/';
const push = vi.fn();
const logout = vi.fn();
const toastError = vi.fn();
let auth: { user: { id: string; name: string; role?: string; mustChangePassword?: boolean } | null; loading: boolean; logout: () => Promise<void> } = {
  user: null,
  loading: false,
  logout,
};
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }));
vi.mock('./AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('./ToastProvider', () => ({ useToast: () => ({ error: toastError }) }));

beforeEach(() => {
  pathname = '/';
  push.mockReset();
  logout.mockReset();
  logout.mockResolvedValue(undefined);
  toastError.mockReset();
  auth = { user: null, loading: false, logout };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ unreadCount: 0 }), { status: 200 }))));
});

describe('SkipLink (GEN-14)', () => {
  it('is the first focusable element and targets the main content', async () => {
    render(
      <>
        <SkipLink />
        <Header />
        <main id="main-content" tabIndex={-1}>
          content
        </main>
      </>,
    );
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main-content');
  });
});

describe('Header (GEN-14)', () => {
  it('has a banner with the site name linking home and a labelled primary nav', () => {
    render(<Header />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /travel planning/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('lists every primary destination and the sign-in links', () => {
    render(<Header />);
    const expected: Record<string, string> = {
      Home: '/',
      Flights: '/flights',
      Hotels: '/hotels',
      Itineraries: '/itineraries',
      Blog: '/blog',
      Login: '/login',
      Register: '/register',
    };
    for (const [name, href] of Object.entries(expected)) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('marks only the current page with aria-current="page"', () => {
    pathname = '/hotels';
    render(<Header />);
    expect(screen.getByRole('link', { name: 'Hotels' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('keeps a section highlighted on its sub-pages, and Home only on "/"', () => {
    pathname = '/blog/posts/123';
    render(<Header />);
    expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('highlights Home on the home page', () => {
    render(<Header />);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not mistake /flightsX for /flights', () => {
    pathname = '/flightsX';
    render(<Header />);
    expect(screen.getByRole('link', { name: 'Flights' })).not.toHaveAttribute('aria-current');
  });

  describe('account links (ACC-10)', () => {
    it('shows Login and Register to a guest, and no Account or Logout', () => {
      render(<Header />);
      expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Register' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
      expect(screen.queryByRole('link', { name: /Notifications/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
    });

    it('shows Account and Logout to a logged-in user, and no Login or Register', () => {
      auth = { user: { id: 'u1', name: 'Ziad' }, loading: false, logout };
      render(<Header />);
      expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
      expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/notifications');
      expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Login' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Register' })).toBeNull();
    });

    it('shows neither set while the session is still being checked (no flash of Login)', () => {
      auth = { user: null, loading: true, logout };
      render(<Header />);
      expect(screen.queryByRole('link', { name: 'Login' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Register' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
    });

    it('Logout logs out and goes home', async () => {
      auth = { user: { id: 'u1', name: 'Ziad' }, loading: false, logout };
      render(<Header />);
      await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
      expect(logout).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    });

    it('if logout fails it says so and stays put', async () => {
      logout.mockRejectedValue(new TypeError('offline'));
      auth = { user: { id: 'u1', name: 'Ziad' }, loading: false, logout };
      render(<Header />);
      await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
      expect(toastError.mock.calls[0][0]).toMatch(/couldn.t reach the server/i);
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe('role-aware links (ACC-04)', () => {
    const as = (role: string, extra: object = {}) => {
      auth = { user: { id: 'u1', name: 'X', role, ...extra }, loading: false, logout };
    };
    const linkNames = () =>
      within(screen.getByRole('navigation', { name: 'Primary' }))
        .getAllByRole('link')
        .map((l) => l.textContent);

    it('a USER sees the travel links and My bookings, no area links', () => {
      as('USER');
      render(<Header />);
      expect(screen.getByRole('link', { name: 'My bookings' })).toHaveAttribute('href', '/bookings');
      expect(screen.getByRole('link', { name: 'Flights' })).toBeInTheDocument();
      for (const name of ['Admin', 'Airline', 'Hotel']) expect(screen.queryByRole('link', { name })).toBeNull();
    });

    it.each([
      ['ADMIN', 'Admin', '/admin'],
      ['AIRLINE_MODERATOR', 'Airline', '/airline'],
      ['HOTEL_MODERATOR', 'Hotel', '/hotel'],
    ])('%s sees their own area link and Blog, not the traveller links', (role, label, href) => {
      as(role);
      render(<Header />);
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
      expect(screen.getByRole('link', { name: 'Blog' })).toBeInTheDocument();
      for (const name of ['Flights', 'Itineraries', 'My bookings']) expect(screen.queryByRole('link', { name })).toBeNull();
      expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument();
    });

    it('highlights the current area page', () => {
      as('ADMIN');
      pathname = '/admin';
      render(<Header />);
      expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page');
    });

    it('while the session loads shows only Home and Blog, nothing role-specific', () => {
      auth = { user: null, loading: true, logout };
      render(<Header />);
      expect(linkNames()).toEqual(['Home', 'Blog']);
    });
  });

  describe('forced password change (ACC-11)', () => {
    it('shows only Change password and Logout', async () => {
      auth = { user: { id: 'u1', name: 'X', role: 'USER', mustChangePassword: true }, loading: false, logout };
      render(<Header />);
      const nav = screen.getByRole('navigation', { name: 'Primary' });
      expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Change password']);
      expect(screen.getByRole('link', { name: 'Change password' })).toHaveAttribute('href', '/change-password');
      expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Account' })).toBeNull();
    });
  });

  describe('mobile menu', () => {
    it('starts closed with a button wired to the nav', () => {
      render(<Header />);
      const button = screen.getByRole('button', { name: 'Menu' });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      const nav = screen.getByRole('navigation', { name: 'Primary' });
      expect(button).toHaveAttribute('aria-controls', nav.id);
      expect(nav).not.toHaveClass('site-nav-open');
    });

    it('opens and closes with the button', async () => {
      const user = userEvent.setup();
      render(<Header />);
      const button = screen.getByRole('button', { name: 'Menu' });
      const nav = screen.getByRole('navigation', { name: 'Primary' });

      await user.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(nav).toHaveClass('site-nav-open');

      await user.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(nav).not.toHaveClass('site-nav-open');
    });

    it('closes on Escape and returns focus to the button', async () => {
      const user = userEvent.setup();
      render(<Header />);
      const button = screen.getByRole('button', { name: 'Menu' });
      await user.click(button);
      await user.keyboard('{Escape}');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveFocus();
    });

    it('closes when the route changes', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Header />);
      const button = screen.getByRole('button', { name: 'Menu' });
      await user.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');

      pathname = '/flights';
      rerender(<Header />);
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
