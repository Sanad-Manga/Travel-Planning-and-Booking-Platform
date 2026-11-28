import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import { SearchForm } from './SearchForm';
import type { SearchFormValues } from './searchParams';

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.startsWith('/api/airports')
        ? json({
            items: [
              { iataCode: 'CAI', name: 'Cairo International', city: { name: 'Cairo' }, country: { name: 'Egypt' } },
              { iataCode: 'JFK', name: 'John F. Kennedy', city: { name: 'New York' }, country: { name: 'United States' } },
            ],
            page: 1,
            limit: 50,
            total: 2,
            totalPages: 1,
          })
        : json({ statusCode: 404, message: 'Not found' }, 404),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

const valid: SearchFormValues = {
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureDate: '2026-12-01',
  returnDate: '',
  passengers: '2',
  cabinClass: '',
};

function mount(initial: SearchFormValues, onSearch = vi.fn()) {
  render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <SearchForm initial={initial} onSearch={onSearch} />
    </SWRConfig>,
  );
  return onSearch;
}

describe('SearchForm (FLT-11)', () => {
  it('checks the route, dates and passenger count before sending anything', async () => {
    const onSearch = mount({ ...valid, departureAirport: '', arrivalAirport: '', departureDate: '', passengers: '' });
    await userEvent.click(screen.getByRole('button', { name: 'Search flights' }));

    expect(await screen.findByText('Choose a departure airport.')).toBeInTheDocument();
    expect(screen.getByText('Choose an arrival airport.')).toBeInTheDocument();
    expect(screen.getByText('Choose a departure date.')).toBeInTheDocument();
    expect(screen.getByText('Enter how many passengers are travelling.')).toBeInTheDocument();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('rejects a return date before the departure date', async () => {
    const onSearch = mount({ ...valid, departureDate: '2026-12-08', returnDate: '2026-12-01' });
    await userEvent.click(screen.getByRole('button', { name: 'Search flights' }));

    expect(await screen.findByText('The return date must be on or after the departure date.')).toBeInTheDocument();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('sends the form with normalised airport codes once everything is valid', async () => {
    const onSearch = mount({ ...valid, departureAirport: 'cai', arrivalAirport: 'jfk' });
    await userEvent.click(screen.getByRole('button', { name: 'Search flights' }));

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ departureAirport: 'CAI', arrivalAirport: 'JFK', passengers: '2' }));
  });
});
