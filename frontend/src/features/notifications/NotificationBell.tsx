'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApi } from '@/api/useApi';

/** SWR key of the unread count; the list revalidates it after marking a notification read. */
export const UNREAD_COUNT_KEY = '/api/notifications/unread-count';

/**
 * GEN-01: the header link to /notifications with the number of unread notifications. Rendered by the
 * Header only for a signed-in user (any role). Rechecks every minute and whenever the window regains focus.
 */
export function NotificationBell() {
  const pathname = usePathname();
  const { data } = useApi<{ unreadCount: number }>(UNREAD_COUNT_KEY, { refreshInterval: 60_000 });
  const unread = data?.unreadCount ?? 0;
  const current = pathname === '/notifications';
  return (
    <Link
      className="site-nav-link notification-bell"
      href="/notifications"
      aria-current={current ? 'page' : undefined}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <span>Notifications</span>
      {unread > 0 ? (
        <span className="notification-badge" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
