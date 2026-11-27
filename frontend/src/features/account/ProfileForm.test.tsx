import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import { ProfileForm } from './ProfileForm';

const refresh = vi.fn();
const toastSuccess = vi.fn();
const me = { id: 'u1', name: 'Ali Hassan', email: 'ali@example.com', phone: '+201001234567', preferredCurrency: 'EGP', role: 'USER' };
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ user: me, loading: false, refresh }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ success: toastSuccess, error: vi.fn() }) }));

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const currencies = json(200, { items: [{ code: 'EGP' }, { code: 'EUR' }, { code: 'USD' }], page: 1, limit: 50, total: 3, totalPages: 1 });
let patch: () => Response;

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  refresh.mockResolvedValue(undefined);
  toastSuccess.mockReset();
  patch = () => json(200, me);
  fetchMock.mockImplementation((url: string) => Promise.resolve(url.startsWith('/api/currencies') ? currencies.clone() : patch()));
  vi.stubGlobal('fetch', fetchMock);
});

function mount() {
  return render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), dedupingInterval: 0 }}>
      <ProfileForm />
    </SWRConfig>,
  );
}
const patchCall = () => fetchMock.mock.calls.find(([url]) => url === '/api/users/me');

describe('ProfileForm (ACC-09)', () => {
  it('starts with the current name, phone and currency', async () => {
    mount();
    expect(screen.getByLabelText(/Full name/)).toHaveValue('Ali Hassan');
    expect(screen.getByLabelText(/Phone/)).toHaveValue('+201001234567');
    expect(await screen.findByRole('combobox', { name: /Preferred currency/ })).toHaveValue('EGP');
  });

  it('saves name, phone and a newly picked currency, refreshes the user and says so', async () => {
    mount();
    await userEvent.clear(screen.getByLabelText(/Full name/));
    await userEvent.type(screen.getByLabelText(/Full name/), 'Ali H.');
    const picker = screen.getByRole('combobox', { name: /Preferred currency/ });
    fireEvent.focus(picker);
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'EUR' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Profile saved.'));
    const [, init] = patchCall()!;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ name: 'Ali H.', phone: '+201001234567', preferredCurrency: 'EUR' });
    expect(refresh).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Profile saved.');
  });

  it('checks the fields before sending: empty name and a bad phone', async () => {
    mount();
    await userEvent.clear(screen.getByLabelText(/Full name/));
    await userEvent.clear(screen.getByLabelText(/Phone/));
    await userEvent.type(screen.getByLabelText(/Phone/), '12ab');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Use 7 to 15 digits, with an optional + at the start.')).toBeInTheDocument();
    expect(patchCall()).toBeUndefined();
  });

  it('an empty phone is allowed and removes the number', async () => {
    mount();
    await userEvent.clear(screen.getByLabelText(/Phone/));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(JSON.parse(patchCall()![1].body).phone).toBe('');
  });

  it('shows backend field errors next to the field and saves nothing', async () => {
    patch = () =>
      json(400, { statusCode: 400, message: 'Validation failed', details: [{ field: 'preferredCurrency', message: 'preferredCurrency is not supported' }] });
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('preferredCurrency is not supported')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
