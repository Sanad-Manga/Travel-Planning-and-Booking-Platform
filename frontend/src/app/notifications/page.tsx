import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { RequireAuth } from '@/components/RequireAuth';
import { NotificationList } from '@/features/notifications/NotificationList';

export const metadata: Metadata = { title: 'Notifications | Travel Planning and Booking Platform' };

/** GEN-01: /notifications, for every role. */
export default function NotificationsPage() {
  return (
    <RequireAuth>
      <PageHeader title="Notifications" description="Bookings, refunds, schedule changes and account updates." />
      <NotificationList />
    </RequireAuth>
  );
}
