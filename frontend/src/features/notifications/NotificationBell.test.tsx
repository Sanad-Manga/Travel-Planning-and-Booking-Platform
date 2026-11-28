import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import { NotificationBell } from './NotificationBell';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const fetchMock = vi.fn();
const count = (unreadCount: number) => new Response(JSON.stringify({ unreadCount }), { status: 200 });

beforeEach(() => {
  pathname = '/';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function mount() {
  return render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <NotificationBell />
    </SWRConfig>,
  );
}

describe('NotificationBell (GEN-01)', () => {
  it('links to /notifications and shows the unread count', async () => {
    fetchMock.mockResolvedValue(count(3));
    mount();
    expect(await screen.findByText('3')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Notifications, 3 unread' });
    expect(link).toHaveAttribute('href', '/notifications');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/unread-count');
  });

  it('shows no number when everything is read', async () => {
    fetchMock.mockResolvedValue(count(0));
    mount();
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('caps a large count at 99+', async () => {
    fetchMock.mockResolvedValue(count(250));
    mount();
    expect(await screen.findByText('99+')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Notifications, 250 unread' })).toBeInTheDocument();
  });

  it('marks itself as the current page on /notifications', async () => {
    pathname = '/notifications';
    fetchMock.mockResolvedValue(count(1));
    mount();
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toHaveAttribute('aria-current', 'page');
  });
});
