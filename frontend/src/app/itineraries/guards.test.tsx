import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EditItineraryPage from './[id]/edit/page';
import NewItineraryPage from './new/page';
import ItinerariesPage from './page';

vi.mock('next/navigation', () => ({ usePathname: () => '/itineraries', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'ADMIN', mustChangePassword: false }, loading: false }) }));

describe('itinerary pages are for travellers only (GitHub #225)', () => {
  it.each([
    ['list', async () => <ItinerariesPage />],
    ['new', async () => <NewItineraryPage />],
    ['edit', async () => await EditItineraryPage({ params: Promise.resolve({ id: 'a1' }) })],
  ])('an admin on the %s page is told they have no access, and nothing is fetched', async (_name, build) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(await build());
    expect(screen.getByText('You do not have access to this page.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
