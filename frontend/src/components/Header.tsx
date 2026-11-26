'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toFriendlyError } from '@/lib/apiError';
import { FORCED_PASSWORD_PATH, NEUTRAL_NAV_LINKS, navLinksFor, type NavLink } from '@/lib/roles';
import { useAuth } from './AuthProvider';
import { useToast } from './ToastProvider';

const NAV_ID = 'primary-nav';

const guestLinks = [
  { label: 'Login', href: '/login' },
  { label: 'Register', href: '/register' },
];

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * GEN-14: site name and primary navigation. Under 40rem the links sit behind a Menu button
 * (aria-expanded / aria-controls) that closes on Escape and when the route changes.
 */
export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const { user, loading, logout } = useAuth();
  // Remember which page the menu was opened on: navigating elsewhere closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenOn(null);
        button.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  async function onLogout() {
    try {
      await logout();
      router.push('/');
    } catch (error) {
      const { message, hint } = toFriendlyError(error);
      toast.error(message + ' ' + hint);
    }
  }

  function renderLinks(links: NavLink[]) {
    return links.map((link) => (
      <li key={link.href}>
        <Link
          className="site-nav-link"
          href={link.href}
          aria-current={isCurrent(pathname, link.href) ? 'page' : undefined}
        >
          {link.label}
        </Link>
      </li>
    ));
  }

  const forced = !!user?.mustChangePassword;
  // Nothing role-specific until we know who this is; with a temporary password only the way out.
  const mainLinks: NavLink[] = loading ? NEUTRAL_NAV_LINKS : forced ? [] : navLinksFor(user?.role ?? null);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="site-name" href="/">
          Travel Planning and Booking Platform
        </Link>
        <button
          ref={button}
          type="button"
          className="btn btn-sm site-menu-button"
          aria-expanded={open}
          aria-controls={NAV_ID}
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          Menu
        </button>
        <nav id={NAV_ID} aria-label="Primary" className={open ? 'site-nav site-nav-open' : 'site-nav'}>
          {mainLinks.length > 0 ? <ul className="site-nav-list">{renderLinks(mainLinks)}</ul> : null}
          {loading ? null : (
            <ul className="site-nav-list site-nav-account">
              {user ? (
                <>
                  {renderLinks(
                    forced
                      ? [{ label: 'Change password', href: FORCED_PASSWORD_PATH }]
                      : [{ label: 'Account', href: '/account' }],
                  )}
                  <li>
                    <button type="button" className="site-nav-link site-nav-button" onClick={() => void onLogout()}>
                      Logout
                    </button>
                  </li>
                </>
              ) : (
                renderLinks(guestLinks)
              )}
            </ul>
          )}
        </nav>
      </div>
    </header>
  );
}
