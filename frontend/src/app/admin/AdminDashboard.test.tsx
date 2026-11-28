import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { cloneElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import type { AuthUser } from '@/components/AuthProvider';
import { ApiError } from '@/lib/api';
import { AdminDashboardClient } from './AdminDashboardClient';
import { overviewPaths } from './dashboardData';
import AdminLayout from './layout';
import AdminPage from './page';

const admin: AuthUser = {
  id: 'synthetic-admin', name: 'Example Admin', email: 'admin@example.test',
  role: 'ADMIN', status: 'ACTIVE', emailVerified: true, preferredCurrency: 'USD',
};
let auth: { user: AuthUser | null; loading: boolean };
const router = { replace: vi.fn(), refresh: vi.fn() };
const serverApi = vi.fn<(path: string) => Promise<unknown>>();
const http = vi.fn<(path: string) => Promise<Response>>();
vi.mock('next/navigation', () => ({ usePathname: () => '/admin', useRouter: () => router }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/serverApi', () => ({ serverApi: (path: string) => serverApi(path) }));

const paths = Object.values(overviewPaths);
const counts = [23, 7, 11];
const unauthorized = { ok: false, reason: 'unauthorized' };
const result = (total: number) => ({ items: [{ name: 'Private fixture record' }], page: 1, limit: 1, total, totalPages: total });
const serverCounts = async (path: string) => path === '/api/auth/me'
  ? { ok: true, data: { ...admin, email: 'hidden-email@example.test' } }
  : { ok: true, data: result(counts[paths.indexOf(path)]) };

function view(children: Awaited<ReturnType<typeof AdminPage>>) {
  const cache = new Map();
  const tree = (page = children) => (
    <SWRConfig value={{ ...swrDefaults, shouldRetryOnError: false, dedupingInterval: 0, provider: () => cache }}>
      <AdminLayout>{page && cloneElement(page)}</AdminLayout>
    </SWRConfig>
  );
  const rendered = render(tree());
  return { ...rendered, update: (page = children) => rendered.rerender(tree(page)) };
}

const card = (label: string) => within(screen.getByRole('heading', { name: label }).closest('section')!);
const expectCounts = (accounts: number, airlines: number, hotels: number) => {
  expect(card('Total accounts').getByText(String(accounts), { exact: true })).toBeVisible();
  expect(card('Airlines').getByText(String(airlines), { exact: true })).toBeVisible();
  expect(card('Hotels').getByText(String(hotels), { exact: true })).toBeVisible();
};

beforeEach(() => {
  auth = { user: admin, loading: false };
  serverApi.mockReset().mockImplementation(serverCounts);
  http.mockReset().mockImplementation(async (path) => Response.json(result(counts[paths.indexOf(path)])));
  router.replace.mockClear();
  router.refresh.mockClear();
  vi.stubGlobal('fetch', http);
});
afterEach(() => vi.unstubAllGlobals());

it('verifies the server session before fetching all three first pages, and discloses only totals', async () => {
  const page = await AdminPage();
  expect(serverApi.mock.calls.map(([path]) => path)).toEqual([
    '/api/auth/me', '/api/admin/accounts?page=1&limit=1',
    '/api/admin/providers?type=airline&page=1&limit=1', '/api/admin/providers?type=hotel&page=1&limit=1',
  ]);
  expect(page?.props.state).toEqual({ mode: 'server', adminId: admin.id, totals: { accounts: 23, airlines: 7, hotels: 11 } });
  view(page);
  expect(screen.getByText('Welcome, Example Admin.')).toBeVisible();
  expectCounts(23, 7, 11);
  expect(screen.queryByText('Private fixture record')).toBeNull();
  expect(screen.queryByText('hidden-email@example.test')).toBeNull();
  expect(http).not.toHaveBeenCalled();
});

it.each([
  { role: 'USER' }, { role: 'AIRLINE_MODERATOR' }, { role: 'HOTEL_MODERATOR' },
  { status: 'SUSPENDED' }, { status: 'DEACTIVATED' }, { mustChangePassword: true },
])('stops at the server session check for %j', async (change) => {
  serverApi.mockResolvedValueOnce({ ok: true, data: { ...admin, ...change } });
  expect(await AdminPage()).toBeNull();
  expect(serverApi).toHaveBeenCalledExactlyOnceWith('/api/auth/me');
  expect(http).not.toHaveBeenCalled();
});

it('keeps a real zero distinct from unavailable data and shows a genuine empty state', async () => {
  serverApi.mockImplementation(async (path) => path === '/api/auth/me'
    ? { ok: true, data: admin } : { ok: true, data: { ...result(0), items: [] } });
  view(await AdminPage());
  expectCounts(0, 0, 0);
  expect(screen.getByText('No records yet')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps successful totals after a non-auth failure and retries through a server refresh', async () => {
  serverApi.mockImplementation(async (path) => {
    if (path === overviewPaths.airlines) throw new ApiError(500, 'private internal backend details');
    return serverCounts(path);
  });
  const { update } = view(await AdminPage());
  expect(card('Airlines').getByText('Unavailable')).toBeVisible();
  expect(card('Airlines').queryByText('0')).toBeNull();
  expect(card('Total accounts').getByText('23')).toBeVisible();
  expect(card('Hotels').getByText('11')).toBeVisible();
  expect(screen.queryByText(/private internal/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(router.refresh).toHaveBeenCalledOnce();
  serverApi.mockImplementation(serverCounts);
  update(await AdminPage());
  expectCounts(23, 7, 11);
});

it('discards all privileged totals when any server response is forbidden', async () => {
  serverApi.mockImplementation(async (path) => {
    if (path === overviewPaths.hotels) throw new ApiError(403, 'raw forbidden details');
    return serverCounts(path);
  });
  const page = await AdminPage();
  expect(page?.props.state).toEqual({ mode: 'denied' });
  view(page);
  expect(screen.getByRole('alert')).toHaveTextContent(/unavailable for this session/);
  expect(screen.queryByText('23')).toBeNull();
  expect(screen.queryByText(/raw forbidden/)).toBeNull();
});

it('reports a server session failure separately and skips all protected stats', async () => {
  serverApi.mockRejectedValueOnce(new Error('internal socket details'));
  view(await AdminPage());
  expect(serverApi).toHaveBeenCalledExactlyOnceWith('/api/auth/me');
  expect(screen.getByRole('alert')).toHaveTextContent(/session could not be verified/);
  expect(screen.queryByText(/socket details/)).toBeNull();
});

it('waits for the admin guard on a server 401 before fetching totals in the browser', async () => {
  auth = { user: null, loading: true };
  serverApi.mockResolvedValueOnce(unauthorized);
  const page = await AdminPage();
  const { update } = view(page);
  expect(page?.props.state).toEqual({ mode: 'browser' });
  expect(serverApi).toHaveBeenCalledExactlyOnceWith('/api/auth/me');
  expect(http).not.toHaveBeenCalled();
  auth = { user: { ...admin, role: 'USER' }, loading: false };
  update();
  expect(http).not.toHaveBeenCalled();
  auth = { user: admin, loading: false };
  update();
  expect(await screen.findByText('23')).toBeVisible();
  expectCounts(23, 7, 11);
  expect(http.mock.calls.map(([path]) => path)).toEqual(paths);
});

it('uses a client fallback after a stats 401 without sending previously retrieved totals', async () => {
  serverApi.mockImplementation(async (path) => path === overviewPaths.airlines ? unauthorized : serverCounts(path));
  const page = await AdminPage();
  expect(page?.props.state).toEqual({ mode: 'browser' });
  view(page);
  expect(await screen.findByText('23')).toBeVisible();
  expect(http).toHaveBeenCalledTimes(3);
});

it('shows loading and retries only a failed browser request', async () => {
  let release!: (response: Response) => void;
  let airlineReads = 0;
  http.mockImplementation(async (path) => {
    if (path !== overviewPaths.airlines) return Response.json(result(counts[paths.indexOf(path)]));
    if (airlineReads++ > 0) return Response.json(result(7));
    return new Promise((resolve) => { release = resolve; });
  });
  view(<AdminDashboardClient state={{ mode: 'browser' }} />);
  expect(screen.getByRole('status', { name: 'Loading airlines' })).toBeVisible();
  await act(async () => release(Response.json({ message: 'fixture' }, { status: 500 })));
  expect(card('Airlines').getByText('Unavailable')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('7')).toBeVisible();
  expect(http.mock.calls.map(([path]) => path)).toEqual([...paths, overviewPaths.airlines]);
});

it('hides browser totals when a protected endpoint returns forbidden', async () => {
  http.mockImplementation(async (path) => path === overviewPaths.hotels
    ? Response.json({}, { status: 403 }) : Response.json(result(88)));
  view(<AdminDashboardClient state={{ mode: 'browser' }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable for this session/);
  expect(screen.queryByText('88')).toBeNull();
});

it('does not show an earlier admin’s server payload after an account change or logout', async () => {
  const { update } = view(await AdminPage());
  expectCounts(23, 7, 11);
  http.mockImplementation(async () => Response.json(result(99)));
  auth.user = { ...admin, id: 'other-admin', name: 'Second Admin' };
  update();
  expect(screen.queryByText('23')).toBeNull();
  expect(screen.queryByText('Welcome, Example Admin.')).toBeNull();
  expect(screen.getByText('Welcome, Second Admin.')).toBeVisible();
  auth.user = null;
  update();
  expect(screen.queryByRole('heading', { name: 'Admin dashboard' })).toBeNull();
});
