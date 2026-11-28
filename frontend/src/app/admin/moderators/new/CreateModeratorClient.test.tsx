import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import type { AuthUser } from '@/components/AuthProvider';
import AdminLayout from '../../layout';
import CreateModeratorPage from './page';

const router = { replace: vi.fn(), push: vi.fn() };
let auth: { user: Pick<AuthUser, 'id' | 'role' | 'mustChangePassword'> | null; loading: boolean };
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/moderators/new', useRouter: () => router }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => auth }));

const http = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const moderatorPath = '/api/admin/moderators';
const password = ' Synthetic9Fixture ';
const email = 'fixture@example.test';
const providerId = (index: number) => index.toString(16).padStart(24, '0');
const list = (type: string, page: number, total = 12) => Response.json({
  items: Array.from({ length: Math.max(0, Math.min(10, total - (page - 1) * 10)) }, (_, offset) => {
    const index = (page - 1) * 10 + offset + 1;
    return { id: providerId(index), name: `${type} ${index}`, isActive: index !== 12 };
  }),
  page, limit: 10, total, totalPages: Math.ceil(total / 10),
});
function providerResponse(url: string) {
  const { searchParams } = new URL(url, 'http://localhost');
  return list(searchParams.get('type') ?? '', Number(searchParams.get('page')));
}
function creationResponse() {
  return Response.json({ id: providerId(30), name: 'Synthetic Name', email }, { status: 201 });
}
function mount() {
  const cache = new Map();
  const view = () => <SWRConfig value={{ ...swrDefaults, provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>
    <CreateModeratorPage />
  </SWRConfig>;
  const rendered = render(view());
  return { ...rendered, updateSession: () => rendered.rerender(view()), cache };
}
const selectRole = (role: string) => fireEvent.change(screen.getByLabelText('Moderator role'), { target: { value: role } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const posts = () => http.mock.calls.filter(([url]) => url === moderatorPath);
const fill = () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), { target: { value: ' Synthetic Name ' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: ' FIXTURE@EXAMPLE.TEST ' } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } });
};
async function choose(type: 'airline' | 'hotel', index = 1) {
  selectRole(type === 'airline' ? 'AIRLINE_MODERATOR' : 'HOTEL_MODERATOR');
  fireEvent.click(await screen.findByRole('radio', { name: `Select ${type} ${index}` }));
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((finish) => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(() => {
  auth = { user: { id: 'admin-one', role: 'ADMIN' }, loading: false };
  router.push.mockClear();
  router.replace.mockClear();
  http.mockReset().mockImplementation(async (url) => url === moderatorPath ? creationResponse() : providerResponse(url));
  vi.stubGlobal('fetch', http);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value() { this.open = true; } },
    close: { configurable: true, value() { this.open = false; } },
  });
});
afterEach(() => vi.unstubAllGlobals());

it.each(['guest', 'loading', 'USER', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR', 'forced'])(
  'does not mount the account form or fetch providers for %s', (visitor) => {
    if (visitor === 'guest' || visitor === 'loading') auth = { user: null, loading: visitor === 'loading' };
    else auth.user = { id: 'visitor', role: visitor === 'forced' ? 'ADMIN' : visitor as AuthUser['role'], mustChangePassword: visitor === 'forced' };
    mount();
    expect(screen.queryByLabelText('Full name')).toBeNull();
    expect(http).not.toHaveBeenCalled();
  },
);

it('links from admin and cancels without requesting providers or creating an account', () => {
  const entry = render(<AdminLayout><h1>Admin dashboard</h1></AdminLayout>);
  expect(screen.getByRole('link', { name: 'Create moderator' })).toHaveAttribute('href', '/admin/moderators/new');
  entry.unmount();
  mount();
  expect(screen.getByText(/Select a moderator role/)).toBeVisible();
  click('Cancel');
  expect(router.push).toHaveBeenCalledWith('/admin');
  expect(http).not.toHaveBeenCalled();
});

it('shows errors for missing fields and blocks creation without a valid provider', async () => {
  mount();
  click('Create moderator');
  expect(await screen.findByText('Enter a full name.')).toBeVisible();
  expect(screen.getByText('Choose a moderator role.')).toBeVisible();
  selectRole('HOTEL_MODERATOR');
  await screen.findByRole('table', { name: 'Providers' });
  fill();
  click('Create moderator');
  expect(await screen.findByText('Choose a provider for the selected role.')).toBeVisible();
  expect(posts()).toHaveLength(0);
});

it('selects an inactive provider on page two, preserves it across pages, and then clears it on role change', async () => {
  mount();
  selectRole('AIRLINE_MODERATOR');
  await screen.findByRole('radio', { name: 'Select airline 1' });
  click('Next page');
  fireEvent.click(await screen.findByRole('radio', { name: 'Select airline 12' }));
  expect(screen.getByText('Inactive')).toBeVisible();
  click('Previous page');
  await screen.findByRole('radio', { name: 'Select airline 1' });
  expect(screen.getByText('Selected provider: airline 12')).toBeVisible();
  click('Next page');
  expect(await screen.findByRole('radio', { name: 'Select airline 12' })).toBeChecked();
  selectRole('HOTEL_MODERATOR');
  expect(await screen.findByRole('radio', { name: 'Select hotel 1' })).not.toBeChecked();
  expect(screen.queryByText('Selected provider: airline 12')).toBeNull();
  expect(http.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([
    '/api/admin/providers?type=airline&page=2&limit=10',
    '/api/admin/providers?type=hotel&page=1&limit=10',
  ]));
});

it('handles loading, retry and empty results while suppressing a late previous role response', async () => {
  const delayed = deferred();
  let hotelRequests = 0;
  http.mockImplementation(async (url) => {
    if (url.includes('airline')) return delayed.promise;
    return hotelRequests++ === 0 ? Response.json({}, { status: 500 }) : list('hotel', 1, 0);
  });
  mount();
  selectRole('AIRLINE_MODERATOR');
  expect(screen.getByRole('status')).toHaveTextContent('Loading Providers');
  expect(screen.getByRole('button', { name: 'Create moderator' })).toBeDisabled();
  selectRole('HOTEL_MODERATOR');
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No hotels found')).toBeVisible();
  await act(async () => delayed.resolve(list('airline', 1)));
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.getByRole('button', { name: 'Create moderator' })).toBeDisabled();
  expect(posts()).toHaveLength(0);
});

it.each(['airline', 'hotel'] as const)('posts an exact %s body once and discloses the submitted password', async (type) => {
  const pending = deferred();
  http.mockImplementation(async (url) => url === moderatorPath ? pending.promise : providerResponse(url));
  const view = mount();
  fill();
  await choose(type);
  const form = screen.getByRole('textbox', { name: 'Full name' }).closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Full name' })).toBeDisabled();
  expect(JSON.parse(String(posts()[0][1].body))).toEqual({
    name: 'Synthetic Name', email, role: type === 'airline' ? 'AIRLINE_MODERATOR' : 'HOTEL_MODERATOR',
    temporaryPassword: password, [type === 'airline' ? 'airlineId' : 'hotelId']: providerId(1),
  });
  await act(async () => pending.resolve(creationResponse()));
  const dialog = await screen.findByRole('dialog', { name: 'Moderator created successfully' });
  expect(dialog).toBeVisible();
  expect(within(dialog).getByLabelText('Temporary password')).toHaveValue(password);
  expect(screen.getByLabelText(/^Password/)).toHaveValue('');
  expect(JSON.stringify([...view.cache])).not.toContain(password);
  click('Done');
  expect(screen.queryByDisplayValue(password)).toBeNull();
  expect(router.push).toHaveBeenCalledWith('/admin');
});

it.each([
  [409, [{ field: 'email', message: 'email already exists' }], 'email already exists'],
  [400, [{ field: 'name', message: 'name rejected by backend' }, { field: 'role', message: 'role rejected by backend' },
    { field: 'temporaryPassword', message: 'password rejected by backend' }], 'name rejected by backend'],
  [404, [{ field: 'hotelId', message: 'hotelId does not match an existing hotel' }], 'hotelId does not match an existing hotel'],
  [400, [{ field: 'unexpected', message: password }], 'Some details could not be accepted. Review the form.'],
])('maps backend status %s to visible fields or a safe alert', async (status, details, expected) => {
  http.mockImplementation(async (url) => url === moderatorPath ? Response.json({ details }, { status }) : providerResponse(url));
  mount();
  fill();
  await choose('hotel');
  click('Create moderator');
  const message = await screen.findByText(expected);
  if (status === 409) expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveAccessibleDescription(expected);
  if (status === 404) {
    expect(screen.getByRole('group', { name: 'Select a hotel' })).toHaveAccessibleDescription(expected);
    expect(screen.getByRole('radio', { name: 'Select hotel 1' })).not.toBeChecked();
    click('Refresh providers');
    await waitFor(() => expect(http.mock.calls.filter(([url]) => url.includes('/api/admin/providers'))).toHaveLength(2));
  }
  if (expected === 'name rejected by backend') {
    expect(screen.getByRole('textbox', { name: 'Full name' })).toHaveAccessibleDescription(expected);
    expect(screen.getByLabelText('Moderator role')).toHaveAccessibleDescription('role rejected by backend');
    expect(screen.getByLabelText(/^Password/)).toHaveAccessibleDescription(/password rejected by backend/);
  }
  expect(message).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Full name' })).toHaveValue(' Synthetic Name ');
});

it.each(['network', 'server', 'audit'])('does not replay an ambiguous %s failure', async (kind) => {
  http.mockImplementation(async (url) => {
    if (url !== moderatorPath) return providerResponse(url);
    if (kind === 'network') throw new TypeError('Network offline');
    const message = kind === 'audit'
      ? 'Moderator account was created but the audit record failed. Do not create it again; tell the lead.'
      : 'internal fixture details';
    return Response.json({ message }, { status: 500 });
  });
  mount();
  fill();
  await choose('hotel');
  click('Create moderator');
  expect(await screen.findByText(kind === 'audit' ? /audit record failed/ : /may have been created/)).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('internal fixture details')).toBeNull();
  expect(posts()).toHaveLength(1);
});

it.each(['unmount', 'sign out', 'different admin'])('suppresses late successful responses after %s', async (kind) => {
  const pending = deferred();
  http.mockImplementation(async (url) => url === moderatorPath ? pending.promise : providerResponse(url));
  const view = mount();
  fill();
  await choose('airline');
  click('Create moderator');
  await waitFor(() => expect(posts()).toHaveLength(1));
  if (kind === 'unmount') view.unmount();
  else {
    auth.user = kind === 'sign out' ? null : { id: 'admin-two', role: 'ADMIN' };
    view.updateSession();
  }
  await act(async () => pending.resolve(creationResponse()));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByDisplayValue(password)).toBeNull();
  expect(posts()).toHaveLength(1);
});
