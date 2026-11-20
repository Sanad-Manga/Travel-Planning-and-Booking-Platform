import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { SkipLink } from './SkipLink';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

beforeEach(() => {
  pathname = '/';
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
