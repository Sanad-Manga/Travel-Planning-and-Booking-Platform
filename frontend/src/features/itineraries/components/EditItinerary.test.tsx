import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, countries, egyptTrip, json, mountWithProviders } from '../testing';
import { EditItinerary } from './EditItinerary';

const toast = { success: vi.fn(), error: vi.fn() };
const push = vi.fn();
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const fetchMock = vi.fn();
let stored: typeof egyptTrip;
let missing: boolean;

beforeEach(() => {
  stored = { ...egyptTrip };
  missing = false;
  push.mockReset();
  toast.success.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/countries')) return Promise.resolve(json(countries));
    if (missing) return Promise.resolve(apiError(404, 'Itinerary not found'));
    if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
    if (init?.method === 'PATCH') stored = { ...stored, ...JSON.parse(String(init.body)) };
    return Promise.resolve(json(stored));
  });
  vi.stubGlobal('fetch', fetchMock);
});

const calls = (method: string) => fetchMock.mock.calls.filter(([, init]) => init?.method === method);
const mount = () => mountWithProviders(<EditItinerary id="a1" />);

describe('EditItinerary (ITN-01, ITN-20)', () => {
  it('starts with the saved title, countries and start date', async () => {
    mount();
    expect(await screen.findByLabelText(/Title/)).toHaveValue('Two weeks in Egypt');
    expect(screen.getByLabelText(/Start date/)).toHaveValue('2026-12-20');
    expect(await screen.findByRole('button', { name: 'Remove Egypt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove United Arab Emirates' })).toBeInTheDocument();
  });

  it('saves the edited basics without touching visibility', async () => {
    mount();
    const title = await screen.findByLabelText(/Title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'Nile trip');
    fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: '2027-01-05' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Itinerary saved.'));
    expect(JSON.parse(String(calls('PATCH')[0][1].body))).toEqual({ title: 'Nile trip', countryCodes: ['EG', 'AE'], startDate: '2027-01-05' });
  });

  it('shows the fresh values when the itinerary changed elsewhere, so saving cannot undo that change', async () => {
    const cache = new Map();
    const first = mountWithProviders(<EditItinerary id="a1" />, cache);
    expect(await screen.findByLabelText(/Title/)).toHaveValue('Two weeks in Egypt');
    first.unmount();
    stored = { ...stored, title: 'Renamed in another tab' };
    mountWithProviders(<EditItinerary id="a1" />, cache);
    await vi.waitFor(() => expect(screen.getByLabelText(/Title/)).toHaveValue('Renamed in another tab'));
  });

  it('says what the visibility is and toggles it', async () => {
    mount();
    expect(await screen.findByText('Only you can see this itinerary.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make public' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Make public' }));
    expect(await screen.findByText('Anyone can find and read this itinerary. Only you can change it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make private' })).toBeInTheDocument();
  });

  it('deletes after confirmation and goes back to the list', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete itinerary' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete itinerary' }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/itineraries'));
    expect(calls('DELETE')).toHaveLength(1);
  });

  it('says so when the itinerary is missing or belongs to someone else', async () => {
    missing = true;
    mount();
    expect(await screen.findByText('We couldn’t find that itinerary.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to my itineraries' })).toHaveAttribute('href', '/itineraries');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});
