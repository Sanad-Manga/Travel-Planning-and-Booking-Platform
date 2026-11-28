import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, countries, json, mountWithProviders } from '../testing';
import { NewItinerary } from './NewItinerary';

const toast = { success: vi.fn(), error: vi.fn() };
const push = vi.fn();
vi.mock('@/components/ToastProvider', () => ({ useToast: () => toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const fetchMock = vi.fn();
let post: () => Promise<Response>;

beforeEach(() => {
  push.mockReset();
  toast.success.mockReset();
  post = () => Promise.resolve(json({ id: 'new1' }, 201));
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => (url.startsWith('/api/countries') ? Promise.resolve(json(countries)) : post()));
  vi.stubGlobal('fetch', fetchMock);
});

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

async function addCountry(name: string) {
  fireEvent.focus(screen.getByRole('combobox', { name: /Countries/ }));
  fireEvent.mouseDown(await screen.findByRole('option', { name: new RegExp(name) }));
}

async function fill() {
  await userEvent.type(screen.getByLabelText(/Title/), 'Egypt and the UAE');
  await addCountry('Egypt');
  await addCountry('United Arab Emirates');
  fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: '2026-12-20' } });
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Create itinerary' }));

describe('NewItinerary (ITN-01)', () => {
  it('checks every field before sending anything', async () => {
    mountWithProviders(<NewItinerary />);
    await submit();
    expect(await screen.findByText('Enter a title.')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one country.')).toBeInTheDocument();
    expect(screen.getByText('Choose a start date.')).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('adds countries as removable chips and offers each country once', async () => {
    mountWithProviders(<NewItinerary />);
    await addCountry('Egypt');
    expect(screen.getByRole('button', { name: 'Remove Egypt' })).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('combobox', { name: /Countries/ }));
    expect(screen.queryByRole('option', { name: /Egypt/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Egypt' }));
    expect(screen.queryByRole('button', { name: 'Remove Egypt' })).toBeNull();
  });

  it('creates a private itinerary and goes back to the list', async () => {
    mountWithProviders(<NewItinerary />);
    await fill();
    await submit();
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/itineraries'));
    expect(posts()[0][0]).toBe('/api/itineraries');
    expect(JSON.parse(String(posts()[0][1].body))).toEqual({ title: 'Egypt and the UAE', countryCodes: ['EG', 'AE'], startDate: '2026-12-20' });
    expect(toast.success).toHaveBeenCalledWith('Itinerary created. Only you can see it.');
  });

  it("shows the backend's field errors next to their fields", async () => {
    post = () => Promise.resolve(apiError(400, 'Validation failed', [{ field: 'countryCodes', message: 'unknown country code(s): ZZ' }]));
    mountWithProviders(<NewItinerary />);
    await fill();
    await submit();
    expect(await screen.findByText('unknown country code(s): ZZ')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('offers Try again when the server cannot be reached', async () => {
    post = () => Promise.reject(new TypeError('offline'));
    mountWithProviders(<NewItinerary />);
    await fill();
    await submit();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    post = () => Promise.resolve(json({ id: 'new1' }, 201));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/itineraries'));
  });

  it('cannot be sent twice while it is saving', async () => {
    let finish: (response: Response) => void = () => undefined;
    post = () => new Promise<Response>((resolve) => { finish = resolve; });
    mountWithProviders(<NewItinerary />);
    await fill();
    await submit();
    const button = screen.getByRole('button', { name: /Create itinerary|Creating/ });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(posts()).toHaveLength(1);
    finish(json({ id: 'new1' }, 201));
    await vi.waitFor(() => expect(push).toHaveBeenCalled());
  });
});
