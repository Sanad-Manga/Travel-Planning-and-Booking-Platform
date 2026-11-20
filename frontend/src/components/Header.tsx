'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const NAV_ID = 'primary-nav';

const mainLinks = [
  { label: 'Home', href: '/' },
  { label: 'Flights', href: '/flights' },
  { label: 'Hotels', href: '/hotels' },
  { label: 'Itineraries', href: '/itineraries' },
  { label: 'Blog', href: '/blog' },
];

// Account and Logout replace these once the session exists (ACC-10).
const accountLinks = [
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

  function renderLinks(links: typeof mainLinks) {
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
          <ul className="site-nav-list">{renderLinks(mainLinks)}</ul>
          <ul className="site-nav-list site-nav-account">{renderLinks(accountLinks)}</ul>
        </nav>
      </div>
    </header>
  );
}
