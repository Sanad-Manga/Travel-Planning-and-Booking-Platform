import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import { NotificationBell } from './NotificationBell';
import { NotificationList } from './NotificationList';

vi.mock('next/navigation', () => ({ usePathname: () => '/notifications' }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const confirmed = {
  id: 'n1',
  type: 'BOOKING_CONFIRMED',
  title: 'Booking confirmed',
  message: 'Your flight MS 985 is confirmed.',
  link: '/bookings/flights/b1',
  isRead: false,
  createdAt: '2026-11-20T14:30:00.000Z',
};
const refunded = { ...confirmed, id: 'n2', type: 'REFUND_COMPLETED', title: 'Refund sent', message: 'EGP 1,200.00 is on its way.', link: undefined, isRead: true };

let items: Array<typeof confirmed | typeof refunded>;
let unread: number;

beforeEach(() => {
  items = [confirmed, refunded];
  unread = 1;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/notifications/unread-count') return Promise.resolve(json({ unreadCount: unread }));
    if (url.startsWith('/api/notifications?')) return Promise.resolve(json({ items, page: 1, limit: 10, total: items.length, totalPages: 1 }));
    if (url === '/api/notifications/n1/read' && init?.method === 'PATCH') {
      items = items.map((n) => (n.id === 'n1' ? { ...n, isRead: true } : n));
      unread = 0;
      return Promise.resolve(json({ ...confirmed, isRead: true }));
    }
    return Promise.resolve(json({ statusCode: 404, message: 'Not found' }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
});

function mount() {
  return render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <NotificationBell />
      <NotificationList />
    </SWRConfig>,
  );
}

describe('NotificationList (GEN-01)', () => {
  it('lists notifications newest first with their status and link, ten per page', async () => {
    mount();
    expect(await screen.findAllByText('Booking confirmed')).not.toHaveLength(0);
    expect(screen.getAllByText('Refund sent').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Open/ })[0]).toHaveAttribute('href', '/bookings/flights/b1');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/notifications?page=1&limit=10')).toBe(true);
  });

  it('marking one as read updates the list and the bell count', async () => {
    mount();
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
    const [markButton] = await screen.findAllByRole('button', { name: 'Mark “Booking confirmed” as read' });
    await userEvent.click(markButton);

    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/notifications/n1/read' && init?.method === 'PATCH')).toBe(true);
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /as read/ })).toHaveLength(0);
  });

  it('shows an empty state when there are none', async () => {
    items = [];
    unread = 0;
    mount();
    const title = await screen.findByText('No notifications yet');
    expect(title.closest('[role="status"]')).toBeInTheDocument();
  });

  it('shows an error with Try again when the list cannot load', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith('/api/notifications?') ? json({ statusCode: 500, message: 'Boom' }, 500) : json({ unreadCount: 0 })),
    );
    mount();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
