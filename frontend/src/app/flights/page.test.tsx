import { render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import FlightsPage from './page';

const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

describe('Flights page (FLT-11)', () => {
  it('has an h1, a breadcrumb trail ending here, a description and the search form', () => {
    render(
      <SWRConfig value={{ ...swrDefaults, provider: () => new Map() }}>
        <FlightsPage />
      </SWRConfig>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Flights' })).toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(trail).toHaveTextContent('HomeFlights');
    expect(screen.getByText('Flights', { selector: '[aria-current="page"]' })).toBeInTheDocument();
    expect(document.querySelector('.page-header-description')).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Flight search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search flights' })).toBeInTheDocument();
  });
});
