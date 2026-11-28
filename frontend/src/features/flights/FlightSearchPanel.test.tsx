import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlightSearchItem, FlightSearchPage } from '@/api/flights';
import { swrDefaults } from '@/api/useApi';
import { FlightSearchPanel } from './FlightSearchPanel';
import { toFlightSearchQuery, type SearchFormValues } from './searchParams';

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const form: SearchFormValues = {
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureDate: '2026-12-01',
  returnDate: '',
  passengers: '2',
  cabinClass: '',
};

const outboundFlight: FlightSearchItem = {
  id: 'f1',
  flightNumber: 'MS985',
  airline: { id: 'a1', name: 'EgyptAir', code: 'MS' },
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureAt: '2026-12-01T12:30:00.000Z',
  arrivalAt: '2026-12-02T00:45:00.000Z',
  departureLocal: '2026-12-01T14:30:00+02:00',
  arrivalLocal: '2026-12-01T19:45:00-05:00',
  departureTimeZone: 'Africa/Cairo',
  arrivalTimeZone: 'America/New_York',
  currency: 'USD',
  cabins: [
    { cabinClass: 'ECONOMY', priceCents: 45000, availableSeats: 12 },
    { cabinClass: 'BUSINESS', priceCents: 180000, availableSeats: 3 },
  ],
};

const returnFlight: FlightSearchItem = {
  ...outboundFlight,
  id: 'f2',
  flightNumber: 'MS986',
  departureAirport: 'JFK',
  arrivalAirport: 'CAI',
  departureAt: '2026-12-08T18:00:00.000Z',
  arrivalAt: '2026-12-09T10:15:00.000Z',
  departureTimeZone: 'America/New_York',
  arrivalTimeZone: 'Africa/Cairo',
};

const page = (items: FlightSearchItem[], totalPages = 1): FlightSearchPage => ({
  items,
  page: 1,
  limit: 10,
  total: items.length,
  totalPages,
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.startsWith('/api/airports')
        ? json({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 })
        : url.startsWith('/api/flights/search')
          ? json(page([outboundFlight], 3))
          : json({ statusCode: 404, message: 'Not found' }, 404),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

function mount(query: ReturnType<typeof toFlightSearchQuery> | null, onQueryChange = vi.fn()) {
  render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <FlightSearchPanel query={query} onQueryChange={onQueryChange} />
    </SWRConfig>,
  );
  return onQueryChange;
}

describe('FlightSearchPanel (FLT-11, FLT-12, FLT-15)', () => {
  it('shows the prompt instead of a request before the first search', () => {
    mount(null);
    expect(screen.getByText('Compare flights in one place')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/flights/search'))).toBe(false);
  });

  it('shows airport-local times and formatted prices, and asks the API for the criteria', async () => {
    mount(toFlightSearchQuery(form));

    expect(await screen.findByText('EgyptAir')).toBeInTheDocument();
    expect(screen.getByText(/14:30/)).toBeInTheDocument();
    expect(screen.getByText(/19:45/)).toBeInTheDocument();
    expect(screen.getByText(/\$450\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,800\.00/)).toBeInTheDocument();

    const searchUrl = fetchMock.mock.calls.map(([url]) => String(url)).find((url) => url.startsWith('/api/flights/search'));
    expect(searchUrl).toContain('departureAirport=CAI');
    expect(searchUrl).toContain('arrivalAirport=JFK');
    expect(searchUrl).toContain('passengers=2');
  });

  it('shows outbound and return sections for a round trip', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/api/airports')
          ? json({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 })
          : json({ outbound: page([outboundFlight]), return: page([returnFlight]) }),
      ),
    );
    mount(toFlightSearchQuery({ ...form, returnDate: '2026-12-08' }));

    expect(await screen.findByRole('heading', { name: 'Outbound flights' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Return flights' })).toBeInTheDocument();
    expect(screen.getByText('MS985')).toBeInTheDocument();
    expect(screen.getByText('MS986')).toBeInTheDocument();
    expect(screen.getByText(/Round trip/)).toBeInTheDocument();
  });

  it('applies a price filter and sort without dropping the route', async () => {
    const onQueryChange = mount(toFlightSearchQuery(form));
    await screen.findByText('EgyptAir');

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'price:asc');
    await userEvent.type(screen.getByLabelText('Min price (USD)'), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(onQueryChange).toHaveBeenCalledWith(
      expect.objectContaining({
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureDate: '2026-12-01',
        passengers: 2,
        minPrice: 40000,
        sort: 'price',
        order: 'asc',
        page: 1,
      }),
    );
  });

  it('refuses a minimum price above the maximum, and a non-numeric price', async () => {
    const onQueryChange = mount(toFlightSearchQuery(form));
    await screen.findByText('EgyptAir');

    await userEvent.type(screen.getByLabelText('Min price (USD)'), '900');
    await userEvent.type(screen.getByLabelText('Max price (USD)'), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByText('The minimum price cannot be more than the maximum.')).toBeInTheDocument();
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it('moves to the next page and keeps the search criteria', async () => {
    const onQueryChange = mount(toFlightSearchQuery(form));
    await screen.findByText('EgyptAir');

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ departureAirport: 'CAI', page: 2 }));
  });

  it('shows an empty state when no flight matches', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith('/api/airports') ? json({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 }) : json(page([]))),
    );
    mount(toFlightSearchQuery(form));

    expect(await screen.findByText('No flights found')).toBeInTheDocument();
    expect(screen.getByText(/Try other dates or airports/)).toBeInTheDocument();
  });

  it('shows an error with a retry when the request fails', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/api/airports')
          ? json({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 })
          : json({ statusCode: 500, message: 'Boom' }, 500),
      ),
    );
    mount(toFlightSearchQuery(form));

    expect(await screen.findByText('Could not load flights')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
