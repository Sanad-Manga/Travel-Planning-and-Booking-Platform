import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/roles';
import AdminPage from './admin/page';
import AirlinePage from './airline/page';
import BookingsPage from './bookings/page';
import HotelPage from './hotel/page';

let auth: { user: { id: string; role: Role } | null; loading: boolean } = { user: null, loading: false };
vi.mock('next/navigation', () => ({ usePathname: () => '/x', useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth = { user: null, loading: false };
});

const pages = [
  ['Admin', AdminPage, 'ADMIN'],
  ['Airline', AirlinePage, 'AIRLINE_MODERATOR'],
  ['Hotel', HotelPage, 'HOTEL_MODERATOR'],
  ['My bookings', BookingsPage, 'USER'],
] as const;

describe('role home pages (ACC-04)', () => {
  it.each(pages)('%s shows its heading to the right role', (name, Page, role) => {
    auth = { user: { id: 'u', role }, loading: false };
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it.each(pages)('%s hides the page from a guest', (name, Page) => {
    render(<Page />);
    expect(screen.queryByRole('heading', { level: 1, name })).toBeNull();
  });

  it.each(pages)('%s tells another role they have no access', (name, Page, role) => {
    const other: Role = role === 'ADMIN' ? 'USER' : 'ADMIN';
    auth = { user: { id: 'u', role: other }, loading: false };
    render(<Page />);
    expect(screen.queryByRole('heading', { level: 1, name })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this page');
  });
});
