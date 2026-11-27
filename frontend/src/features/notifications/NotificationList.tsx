'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import type { ResponseOf } from '@/api/types';
import { usePaginated } from '@/api/usePaginated';
import { DataTable, type TableColumn } from '@/components/DataTable';
import { Pagination } from '@/components/Pagination';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { toFriendlyError } from '@/lib/apiError';
import { formatInZone } from '@/lib/formatInZone';
import { UNREAD_COUNT_KEY } from './NotificationBell';

type Notification = ResponseOf<'/api/notifications'>['items'][number];

/** The viewer's own zone: a notification time is "when it happened for me", not a flight time. */
function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * GEN-01: my notifications, newest first, ten per page (GEN-05 table and pagination). An unread one has a
 * "Mark as read" button (there is no mark-all route); afterwards the list and the header count reload.
 */
export function NotificationList() {
  const list = usePaginated<Notification>('/api/notifications');
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const [marking, setMarking] = useState<string | null>(null);

  async function markRead(notification: Notification) {
    setMarking(notification.id);
    try {
      await api(`/notifications/${notification.id}/read`, { method: 'PATCH' });
      await Promise.all([list.revalidate(), mutate(UNREAD_COUNT_KEY)]);
    } catch (error) {
      const { message, hint } = toFriendlyError(error);
      toast.error(`${message} ${hint}`);
    } finally {
      setMarking(null);
    }
  }

  const columns: TableColumn<Notification>[] = [
    {
      id: 'notification',
      header: 'Notification',
      cell: (n) => (
        <div className="notification-text">
          <p className={n.isRead ? 'notification-title' : 'notification-title notification-title-unread'}>{n.title}</p>
          <p className="notification-message">{n.message}</p>
          {n.link ? (
            <Link href={n.link} aria-label={`Open “${n.title}”`}>
              Open
            </Link>
          ) : null}
        </div>
      ),
    },
    { id: 'received', header: 'Received', cell: (n) => formatInZone(n.createdAt, viewerZone()) },
    {
      id: 'status',
      header: 'Status',
      cell: (n) =>
        n.isRead ? (
          'Read'
        ) : (
          <div className="notification-status">
            <span>Unread</span>
            <button
              type="button"
              className="btn btn-sm"
              aria-label={`Mark “${n.title}” as read`}
              disabled={marking === n.id}
              onClick={() => void markRead(n)}
            >
              {marking === n.id ? 'Marking…' : 'Mark as read'}
            </button>
          </div>
        ),
    },
  ];

  return (
    <>
      <DataTable
        caption="Notifications"
        columns={columns}
        rows={list.items}
        rowKey={(n) => n.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.revalidate()}
        emptyTitle="No notifications yet"
      />
      {list.data && !list.error && list.data.totalPages > 1 ? <Pagination {...list.data} onPageChange={list.setPage} /> : null}
    </>
  );
}
