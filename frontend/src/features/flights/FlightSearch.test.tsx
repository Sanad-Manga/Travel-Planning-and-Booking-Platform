import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import { FlightSearch } from './FlightSearch';

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  nav.search = '';
  nav.replace.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.startsWith('/api/airports')
        ? json({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 })
        : json({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

function mount() {
  render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <FlightSearch />
    </SWRConfig>,
  );
}

describe('FlightSearch URL sync (FLT-11, FLT-12, FLT-15)', () => {
  it('does not request anything until the address bar describes a complete search', () => {
    mount();
    expect(screen.getByText('Compare flights in one place')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/flights/search'))).toBe(false);
  });

  it('refreshes the results from a search URL, and writes the next search back to the URL', async () => {
    nav.search = 'departureAirport=CAI&arrivalAirport=JFK&departureDate=2026-12-01&passengers=2';
    mount();
    expect(await screen.findByRole('heading', { name: /JFK/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Search flights' }));

    expect(nav.replace).toHaveBeenCalledTimes(1);
    const [href, options] = nav.replace.mock.calls[0] as [string, { scroll: boolean }];
    expect(href.startsWith('/flights?')).toBe(true);
    const params = new URL(href, 'http://local').searchParams;
    expect(params.get('departureAirport')).toBe('CAI');
    expect(params.get('arrivalAirport')).toBe('JFK');
    expect(params.get('departureDate')).toBe('2026-12-01');
    expect(params.get('passengers')).toBe('2');
    expect(params.get('page')).toBe('1');
    expect(options).toEqual({ scroll: false });
  });
});
