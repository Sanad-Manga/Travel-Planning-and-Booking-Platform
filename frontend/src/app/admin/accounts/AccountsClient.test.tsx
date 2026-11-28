import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Account } from '@/api/admin';
import { swrDefaults } from '@/api/useApi';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { ToastProvider } from '@/components/ToastProvider';
import AdminPage from '../page';
import AccountsPage from './page';

const router = { replace: vi.fn() };
let auth: { user: { id: string; role: Account['role']; mustChangePassword?: boolean } | null; loading: boolean };
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/accounts', useRouter: () => router }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => auth }));

const row = (id: string, role: Account['role'] = 'USER', status: Account['status'] = 'ACTIVE'): Account => ({
  id, name: id, email: id + '@example.test', role, status, createdAt: '2026-11-01T23:55:00Z',
});
const page = (items: Account[], pageNumber = 1, total = items.length) =>
  Response.json({ items, page: pageNumber, limit: 10, total, totalPages: Math.ceil(total / 10) });
const http = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const firstPage = '/api/admin/accounts?page=1&limit=10';
function mount() {
  const cache = new Map();
  const tree = () => <SWRConfig value={{ ...swrDefaults, provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>
    <ConfirmProvider><ToastProvider><AccountsPage /></ToastProvider></ConfirmProvider>
  </SWRConfig>;
  const view = render(tree());
  return { ...view, refreshAuth: () => view.rerender(tree()), cache };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((finish) => { resolve = finish; });
  return { promise, resolve };
}
function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); }
const urls = () => http.mock.calls.map(([url]) => url);

beforeEach(() => {
  auth = { user: { id: 'self', role: 'ADMIN' }, loading: false };
  http.mockReset().mockImplementation(async () => page([row('Taylor')]));
  vi.stubGlobal('fetch', http);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value() { this.open = true; } },
    close: { configurable: true, value() { this.open = false; } },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('links to the protected route from the admin landing page', () => {
  render(<AdminPage />);
  expect(screen.getByRole('link', { name: 'Manage accounts' })).toHaveAttribute('href', '/admin/accounts');
});

it.each(['guest', 'USER', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR', 'forced', 'loading'])('withholds account requests for %s', (kind) => {
  if (kind === 'guest' || kind === 'loading') auth = { user: null, loading: kind === 'loading' };
  else auth.user = { id: 'visitor', role: kind === 'forced' ? 'ADMIN' : kind as Account['role'], mustChangePassword: kind === 'forced' };
  mount();
  expect(screen.queryByText('Account management')).toBeNull();
  expect(http).not.toHaveBeenCalled();
});

it('renders all six columns, UTC dates, status labels and actions for each eligible role', async () => {
  const rows = [row('root', 'ADMIN'), row('self'), row('inactive', 'USER', 'DEACTIVATED'),
    ...(['USER', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR'] as const).flatMap((role) =>
      [row(role, role), row(role + '-paused', role, 'SUSPENDED')])];
  http.mockResolvedValueOnce(page(rows));
  mount();
  const table = await screen.findByRole('table', { name: 'Accounts' });
  expect(within(table).getAllByRole('columnheader').map((el) => el.textContent))
    .toEqual(['Name', 'Email', 'Role', 'Status', 'Registration date', 'Actions']);
  for (const account of rows) {
    const tr = within(table).getByText(account.email).closest('tr')!;
    expect(tr.querySelector('time')).toHaveTextContent('01 Nov 2026');
    if (['self', 'root', 'inactive'].includes(account.id)) {
      expect(within(tr).getByText('No actions available')).toBeVisible();
      expect(within(tr).queryAllByRole('button')).toHaveLength(0);
    } else {
      expect(within(tr).getAllByRole('button').map((el) => el.textContent))
        .toEqual(account.status === 'ACTIVE' ? ['Suspend', 'Reset password'] : ['Reactivate']);
    }
  }
  expect(within(table).getAllByText('Hotel moderator')).toHaveLength(2);
  expect(within(table).getAllByText('Suspended')).toHaveLength(3);
});

it('paginates on server totals and combines filters; delayed old results stay hidden', async () => {
  const stale = deferred();
  http.mockImplementation(async (url) => {
    if (url.includes('status=SUSPENDED')) return page([]);
    if (url.includes('role=HOTEL_MODERATOR')) return stale.promise;
    if (url.includes('page=2')) return page([row('Second')], 2, 11);
    return page([row('First')], 1, 11);
  });
  mount();
  expect(await screen.findByText('Results 1–10 of 11')).toBeVisible();
  click('Next page');
  expect(await screen.findByText('Results 11–11 of 11')).toBeVisible();
  click('Previous page');
  expect(await screen.findByText('First')).toBeVisible();
  click('Next page');
  await screen.findByText('Second');
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'HOTEL_MODERATOR' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'SUSPENDED' } });
  expect(await screen.findByText('No matching accounts')).toBeVisible();
  await act(async () => stale.resolve(page([row('Obsolete')])));
  expect(screen.queryByText('Obsolete')).toBeNull();
  expect(urls()).toContain('/api/admin/accounts?role=HOTEL_MODERATOR&status=SUSPENDED&page=1&limit=10');
  expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
});

it('debounces 300 ms, trims search, combines filters and cancels pending input on clear', async () => {
  mount();
  await screen.findByText('Taylor');
  const input = screen.getByRole('searchbox');
  expect(input).toHaveAttribute('maxlength', '100');
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'USER' } });
  await waitFor(() => expect(urls().at(-1)).toContain('role=USER'));
  vi.useFakeTimers();
  fireEvent.change(input, { target: { value: 'Ta' } });
  act(() => vi.advanceTimersByTime(250));
  fireEvent.change(input, { target: { value: ' Taylor  ' } });
  act(() => vi.advanceTimersByTime(299));
  expect(urls().some((url) => url.includes('search='))).toBe(false);
  expect(screen.queryByText('Taylor')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(urls().at(-1)).toBe('/api/admin/accounts?role=USER&search=Taylor&page=1&limit=10');
  fireEvent.change(input, { target: { value: 'Discard' } });
  await act(async () => click('Clear filters'));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(input).toHaveValue('');
  expect(urls().at(-1)).toBe(firstPage);
  expect(urls().some((url) => url.includes('Discard'))).toBe(false);
});

it.each(['suspend', 'reactivate'] as const)('confirms %s once, locks competing operations and refreshes status', async (action) => {
  const pending = deferred();
  const active = action === 'suspend';
  const label = active ? 'Suspend account' : 'Reactivate account';
  let changed = false;
  http.mockImplementation(async (_, init) => init.method === 'PATCH' ? pending.promise :
    page([row('Taylor', 'USER', active !== changed ? 'ACTIVE' : 'SUSPENDED')]));
  mount();
  const target = await screen.findByRole('button', { name: label + ' for Taylor' });
  fireEvent.click(target);
  click('Cancel');
  await waitFor(() => expect(target).toBeEnabled());
  expect(http).toHaveBeenCalledTimes(1);
  fireEvent.click(target);
  const accept = within(screen.getByRole('alertdialog')).getByRole('button', { name: label });
  fireEvent.click(accept);
  fireEvent.click(accept);
  expect(target).toBeDisabled();
  expect(http.mock.calls.filter(([, i]) => i.method === 'PATCH')).toHaveLength(1);
  expect(urls()).toContain('/api/admin/accounts/Taylor/' + action);
  changed = true;
  await act(async () => pending.resolve(Response.json({})));
  expect(await screen.findByText(active ? 'Account suspended successfully.' : 'Account reactivated successfully.')).toBeVisible();
  expect(screen.getByRole('button', { name: (active ? 'Reactivate' : 'Suspend') + ' account for Taylor' })).toBeEnabled();
  expect(urls().at(-1)).toBe(firstPage);
});

it.each(['Suspend account', 'Reset password'])('handles an ambiguous %s failure with revalidation and no automatic repeat', async (label) => {
  http.mockImplementation(async (_, init) => init.method === 'GET' ? page([row('Taylor')]) :
    Response.json({ message: 'internal-fixture-details' }, { status: 500 }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: label + ' for Taylor' }));
  click(label);
  expect(await screen.findByRole('alert')).toHaveTextContent(/may have changed/);
  expect(screen.queryByText(/internal-fixture-details/)).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(urls()).toHaveLength(3);
  expect(urls().at(-1)).toBe(firstPage);
});

it.each(['success', 'unmount', 'session ended', 'another administrator'])('limits password disclosure to the issuing view: %s', async (outcome) => {
  const pending = deferred();
  const value = 'synthetic-only-result';
  const result = { id: 'Taylor', expiresAt: '2026-11-28T12:00:00Z', temporaryPassword: value };
  http.mockImplementation(async (_, init) => init.method === 'POST' ? pending.promise : page([row('Taylor')]));
  const view = mount();
  const trigger = await screen.findByRole('button', { name: 'Reset password for Taylor' });
  fireEvent.click(trigger);
  expect(http).toHaveBeenCalledTimes(1);
  click('Reset password');
  expect(screen.queryByRole('dialog')).toBeNull();
  if (outcome === 'unmount') view.unmount();
  if (outcome === 'session ended' || outcome === 'another administrator') {
    auth.user = outcome === 'session ended' ? null : { id: 'replacement', role: 'ADMIN' };
    view.refreshAuth();
  }
  await act(async () => pending.resolve(Response.json(result)));
  if (outcome === 'success') {
    expect(screen.getByDisplayValue(value)).toBeVisible();
    click('Done');
    expect(trigger).toHaveFocus();
  }
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(JSON.stringify(Array.from(view.cache.entries()))).not.toContain(value);
  expect(http.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
});

it('retries a failed list and renders the unfiltered empty state', async () => {
  http.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(page([]));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(/reach the server/);
  click('Try again');
  expect(await screen.findByText('No accounts found')).toBeVisible();
  expect(urls()).toEqual([firstPage, firstPage]);
});
