'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './admin.module.css';

const destinations = [
  { label: 'Dashboard', href: '/admin', available: true },
  { label: 'Accounts', href: '/admin/accounts', available: false },
  { label: 'Create moderator', href: '/admin/moderators/new', available: true },
  { label: 'Providers', href: '/admin/providers', available: false },
  { label: 'Bookings', href: '/admin/bookings', available: false },
  { label: 'Reports', href: '/admin/reports', available: false },
  { label: 'Audit logs', href: '/admin/audit-logs', available: false },
  { label: 'Analytics', href: '/admin/analytics', available: false },
];

export function AdminNavigation() {
  const path = usePathname();
  return (
    <nav aria-label="Admin navigation" className={styles.navigation}>
      <ul>
        {destinations.map(({ label, href, available }) => {
          const active = path === href || (href !== '/admin' && path.startsWith(href + '/'));
          return (
            <li key={href}>
              {available ? (
                <Link className={styles.destination} href={href} aria-current={active ? 'page' : undefined}>{label}</Link>
              ) : (
                <span className={styles.unavailable}>{label} <small>Coming soon</small></span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
