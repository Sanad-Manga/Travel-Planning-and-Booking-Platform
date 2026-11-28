import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, countries, egyptTrip, json, mountWithProviders, page } from '../testing';
import { ItineraryList } from './ItineraryList';

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));

const fetchMock = vi.fn();
type Row = typeof egyptTrip;
let rows: Row[];
let failWrites: boolean;

beforeEach(() => {
  rows = [egyptTrip];
  failWrites = false;
  toast.success.mockReset();
  toast.error.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/countries')) return Promise.resolve(json(countries));
    if (url.startsWith('/api/itineraries?')) return Promise.resolve(json(page(rows)));
    if (url === '/api/itineraries/a1' && failWrites) return Promise.resolve(apiError(500, 'Boom'));
    if (url === '/api/itineraries/a1' && init?.method === 'DELETE') {
      rows = [];
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url === '/api/itineraries/a1' && init?.method === 'PATCH') {
      rows = [{ ...rows[0], ...JSON.parse(String(init.body)) }];
      return Promise.resolve(json(rows[0]));
    }
    return Promise.resolve(apiError(404, 'Not found'));
  });
  vi.stubGlobal('fetch', fetchMock);
});

const calls = (method: string) => fetchMock.mock.calls.filter(([, init]) => init?.method === method);
const dialog = () => screen.getByRole('alertdialog');

describe('ItineraryList (ITN-03)', () => {
  it('lists my itineraries with title, country names, start date, days and visibility, ten per page', async () => {
    mountWithProviders(<ItineraryList />);
    const link = await screen.findByRole('link', { name: 'Two weeks in Egypt' });
    expect(link).toHaveAttribute('href', '/itineraries/a1/edit');
    expect(await screen.findByText('Egypt, United Arab Emirates')).toBeInTheDocument();
    expect(screen.getByText('20 Dec 2026')).toBeInTheDocument();
    expect(screen.getByText('5 days')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New itinerary' })).toHaveAttribute('href', '/itineraries/new');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/itineraries?limit=10&page=1' || url === '/api/itineraries?page=1&limit=10')).toBe(true);
  });

  it('says "1 day" for one day and flags a trip an admin hid', async () => {
    rows = [{ ...egyptTrip, dayCount: 1, isHidden: true }];
    mountWithProviders(<ItineraryList />);
    expect(await screen.findByText('1 day')).toBeInTheDocument();
    expect(screen.getByText('Hidden by an admin')).toBeInTheDocument();
  });

  it('has an empty state whose one action creates an itinerary', async () => {
    rows = [];
    mountWithProviders(<ItineraryList />);
    expect(await screen.findByText('No itineraries yet')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /itinerary/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/itineraries/new');
  });

  it('shows an error with Try again when the list cannot load', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith('/api/countries') ? json(countries) : apiError(500, 'Boom')),
    );
    mountWithProviders(<ItineraryList />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('deletes only after confirmation, then reloads the list', async () => {
    mountWithProviders(<ItineraryList />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete: Two weeks in Egypt' }));
    expect(dialog()).toHaveTextContent('cannot be undone');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Keep itinerary' }));
    expect(calls('DELETE')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Delete: Two weeks in Egypt' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Delete itinerary' }));
    expect(await screen.findByText('No itineraries yet')).toBeInTheDocument();
    expect(calls('DELETE')).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith('Itinerary deleted.');
  });

  it('asks before making a trip public, and makes it private again at once', async () => {
    mountWithProviders(<ItineraryList />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make public: Two weeks in Egypt' }));
    expect(calls('PATCH')).toHaveLength(0);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Make public' }));
    expect(await screen.findByText('Public')).toBeInTheDocument();
    expect(JSON.parse(String(calls('PATCH')[0][1].body))).toEqual({ visibility: 'PUBLIC' });

    await userEvent.click(screen.getByRole('button', { name: 'Make private: Two weeks in Egypt' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await screen.findByText('Private')).toBeInTheDocument();
    expect(JSON.parse(String(calls('PATCH')[1][1].body))).toEqual({ visibility: 'PRIVATE' });
  });

  it('keeps the row and says why when a delete fails', async () => {
    failWrites = true;
    mountWithProviders(<ItineraryList />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete: Two weeks in Egypt' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Delete itinerary' }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Something went wrong on our side.')));
    expect(screen.getByRole('link', { name: 'Two weeks in Egypt' })).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
