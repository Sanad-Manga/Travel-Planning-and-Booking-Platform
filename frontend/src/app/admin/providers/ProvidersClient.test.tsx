import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { swrDefaults } from '@/api/useApi';
import type { AuthUser } from '@/components/AuthProvider';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { ToastProvider } from '@/components/ToastProvider';
import AdminPage from '../page';
import ProvidersPage from './page';

const router = { replace: vi.fn(), push: vi.fn() };
let auth: { user: Pick<AuthUser, 'id' | 'role' | 'mustChangePassword'> | null; loading: boolean };
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/providers', useRouter: () => router }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => auth }));

const http = vi.fn<(url: string, options: RequestInit) => Promise<Response>>();
const ids = ['6730a1f2c3d4e5f607182931', '6730a1f2c3d4e5f607182932'];
const firstAirline = { id: ids[0], name: 'Example Air', isActive: true };
const secondAirline = { id: ids[1], name: 'Second Air', isActive: false };
const hotel = { id: ids[0], name: 'Example Hotel', isActive: true };
const country = { code: 'EG', name: 'Egypt' };
const city = { cityId: 'CAI', name: 'Cairo', countryCode: 'EG' };
const envelope = (items: unknown[], page = 1, total = items.length) =>
  Response.json({ items, page, limit: 10, total, totalPages: Math.ceil(total / 10) });
const success = () => Response.json({}, { status: 201 });
const error = (status: number, message: string, details?: { field: string; message: string }[]) =>
  Response.json({ message, details }, { status });

function fixture(url: string) {
  const { pathname, searchParams } = new URL(url, 'http://localhost');
  if (pathname === '/api/admin/providers') {
    if (searchParams.get('type') === 'hotel') return envelope([hotel]);
    if (searchParams.get('page') === '2') return envelope([{ ...secondAirline, name: 'Later Air' }], 2, 11);
    return envelope([firstAirline, secondAirline], 1, 11);
  }
  if (pathname === '/api/countries') return envelope([country, { code: 'FR', name: 'France' }]);
  if (pathname === '/api/cities') return searchParams.get('countryCode') === 'FR'
    ? envelope([{ cityId: 'PAR', name: 'Paris', countryCode: 'FR' }]) : envelope([city]);
  return success();
}
function mount() {
  return render(
    <SWRConfig value={{ ...swrDefaults, provider: () => new Map(), shouldRetryOnError: false, dedupingInterval: 0 }}>
      <ConfirmProvider><ToastProvider><ProvidersPage /></ToastProvider></ConfirmProvider>
    </SWRConfig>,
  );
}
const calls = () => http.mock.calls.map(([url]) => url);
const mutations = (method: string) => http.mock.calls.filter(([, options]) => options.method === method);
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const input = (name: string) => screen.getByRole('textbox', { name });
const change = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });
const chooseType = (type: 'airline' | 'hotel') => change(screen.getByRole('combobox', { name: 'Provider type' }), type);
async function chooseReference(label: string, value: string) {
  fireEvent.focus(screen.getByRole('combobox', { name: label }));
  fireEvent.mouseDown(await screen.findByRole('option', { name: new RegExp(value) }));
}
function openHotelForm() {
  click('Create provider');
  change(screen.getByRole('combobox', { name: 'New provider type' }), 'hotel');
}
function fillAirline() {
  change(input('Airline name'), ' Example Air ');
  change(input('Airline code'), ' ab9 ');
}
async function fillHotel() {
  change(input('Hotel name'), ' Nile View Hotel ');
  change(input('Address'), ' 12 Corniche ');
  await chooseReference('Country', 'Egypt');
  await chooseReference('City', 'Cairo');
  change(input('Description'), ' Near the river ');
  change(screen.getByRole('combobox', { name: 'Star rating' }), '4');
  change(input('Amenities (optional)'), ' Wifi, Pool, wifi\n Gym ');
}
function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  auth = { user: { id: 'admin', role: 'ADMIN' }, loading: false };
  router.replace.mockClear();
  http.mockReset().mockImplementation(async (url) => fixture(url));
  vi.stubGlobal('fetch', http);
});
afterEach(() => vi.unstubAllGlobals());

it.each(['guest', 'loading', 'USER', 'AIRLINE_MODERATOR', 'HOTEL_MODERATOR', 'forced'])(
  'never requests providers for %s', (visitor) => {
    if (visitor === 'guest' || visitor === 'loading') auth = { user: null, loading: visitor === 'loading' };
    else auth.user = { id: 'visitor', role: visitor === 'forced' ? 'ADMIN' : visitor as AuthUser['role'], mustChangePassword: visitor === 'forced' };
    mount();
    expect(screen.queryByRole('heading', { name: 'Providers' })).toBeNull();
    expect(http).not.toHaveBeenCalled();
  },
);

it('keeps Create moderator and adds the Manage providers dashboard link', () => {
  render(<AdminPage />);
  expect(screen.getByRole('link', { name: 'Create moderator' })).toHaveAttribute('href', '/admin/moderators/new');
  expect(screen.getByRole('link', { name: 'Manage providers' })).toHaveAttribute('href', '/admin/providers');
});

it('shows default airlines, type and state, and resets pagination on type change without stale rows', async () => {
  const later = deferred();
  http.mockImplementation(async (url) => url.includes('type=airline&page=2') ? later.promise : fixture(url));
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Loading Airlines');
  const table = await screen.findByRole('table', { name: 'Airlines' });
  const active = within(table).getByText('Example Air').closest('tr')!;
  expect(within(active).getByText('Airline')).toBeVisible();
  expect(within(active).getByText('Active')).toBeVisible();
  const inactive = within(table).getByText('Second Air').closest('tr')!;
  expect(within(inactive).getByText('Inactive')).toBeVisible();
  expect(within(inactive).getByRole('button', { name: 'Reactivate Second Air' })).toBeVisible();
  click('Next page');
  await waitFor(() => expect(calls()).toContain('/api/admin/providers?type=airline&page=2&limit=10'));
  chooseType('hotel');
  expect(await screen.findByText('Example Hotel')).toBeVisible();
  expect(calls()).toContain('/api/admin/providers?type=hotel&page=1&limit=10');
  await act(async () => later.resolve(fixture('/api/admin/providers?type=airline&page=2')));
  expect(screen.queryByText('Later Air')).toBeNull();
  expect(screen.queryByText('Example Air')).toBeNull();
  expect(within(screen.getByRole('table', { name: 'Hotels' })).getByText('Hotel')).toBeVisible();
});

it('shows a list error with a retry and an empty result message', async () => {
  http.mockResolvedValueOnce(error(500, 'fixture failure')).mockResolvedValueOnce(envelope([]));
  mount();
  expect(await screen.findByRole('alert')).toBeVisible();
  click('Try again');
  expect(await screen.findByText('No airlines found')).toBeVisible();
  expect(http).toHaveBeenCalledTimes(2);
});

it('requires airline details and clears fields and errors when switching form type', async () => {
  mount();
  click('Create provider');
  click('Create airline');
  expect(await screen.findByText('Enter at least 2 characters.')).toBeVisible();
  expect(input('Airline code')).toBeInvalid();
  change(input('Airline name'), 'Temporary entry');
  change(screen.getByRole('combobox', { name: 'New provider type' }), 'hotel');
  expect(input('Hotel name')).toHaveValue('');
  expect(screen.queryByText('Enter at least 2 characters.')).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Airline code' })).toBeNull();
  click('Create hotel');
  expect(await screen.findByText('Select a city.')).toBeVisible();
  expect(screen.getByText('Select a country.')).toBeVisible();
  expect(mutations('POST')).toHaveLength(0);
});

it('preselects the displayed provider type and restores focus when cancelling', async () => {
  mount();
  chooseType('hotel');
  await screen.findByText('Example Hotel');
  click('Create provider');
  expect(screen.getByRole('combobox', { name: 'New provider type' })).toHaveValue('hotel');
  click('Cancel');
  expect(screen.getByRole('button', { name: 'Create provider' })).toHaveFocus();
  expect(mutations('POST')).toHaveLength(0);
});

it('creates an airline once, normalizes the payload, and refreshes the list on success', async () => {
  const post = deferred();
  http.mockImplementation(async (url, request) => request.method === 'POST' ? post.promise : fixture(url));
  mount();
  await screen.findByText('Example Air');
  click('Create provider');
  fillAirline();
  const form = input('Airline name').closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(mutations('POST')).toHaveLength(1));
  expect(input('Airline name')).toBeDisabled();
  expect(JSON.parse(String(mutations('POST')[0][1].body))).toEqual({ name: 'Example Air', code: 'AB9' });
  await act(async () => post.resolve(success()));
  expect(await screen.findByText('Airline created.')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Create provider' })).toBeNull();
  expect(calls().filter((url) => url.includes('type=airline'))).toHaveLength(2);
});

it('shows duplicate airline code beside the field and keeps entered values', async () => {
  http.mockImplementation(async (url) => url === '/api/airlines'
    ? error(409, 'Duplicate code', [{ field: 'code', message: 'code already exists' }]) : fixture(url));
  mount();
  click('Create provider');
  fillAirline();
  click('Create airline');
  expect(await screen.findByText('code already exists')).toBeVisible();
  expect(input('Airline code')).toHaveAccessibleDescription(/code already exists/);
  expect(input('Airline name')).toHaveValue(' Example Air ');
});

it('loads later country and city pages, keeps the selected city, and clears it when country changes', async () => {
  http.mockImplementation(async (url) => {
    const query = new URL(url, 'http://localhost').searchParams;
    const page = Number(query.get('page'));
    if (url.startsWith('/api/countries')) return envelope(page === 2 ? [country] : [{ code: 'FR', name: 'France' }], page, 11);
    if (url.includes('countryCode=EG')) return envelope(page === 2 ? [city] : [{ cityId: 'LXR', name: 'Luxor', countryCode: 'EG' }], page, 11);
    return fixture(url);
  });
  mount();
  openHotelForm();
  expect(screen.getByRole('combobox', { name: 'City' })).toBeDisabled();
  expect(calls().every((url) => !url.startsWith('/api/cities'))).toBe(true);
  const countryGroup = within(screen.getByRole('group', { name: 'Country selection' }));
  fireEvent.click(await countryGroup.findByRole('button', { name: 'Next page' }));
  await chooseReference('Country', 'Egypt');
  const cityGroup = within(screen.getByRole('group', { name: 'City selection' }));
  fireEvent.click(await cityGroup.findByRole('button', { name: 'Next page' }));
  await chooseReference('City', 'Cairo');
  expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('Cairo');
  fireEvent.click(cityGroup.getByRole('button', { name: 'Previous page' }));
  expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('Cairo');
  fireEvent.click(countryGroup.getByRole('button', { name: 'Previous page' }));
  await chooseReference('Country', 'France');
  expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('');
  await chooseReference('City', 'Paris');
  expect(calls()).toContain('/api/cities?countryCode=FR&page=1&limit=10');
});

it('creates a hotel with the seeded city ID, normalized amenities and no unsupported fields', async () => {
  mount();
  openHotelForm();
  await fillHotel();
  click('Create hotel');
  expect(await screen.findByText('Hotel created.')).toBeVisible();
  expect(mutations('POST')[0][0]).toBe('/api/hotels');
  expect(JSON.parse(String(mutations('POST')[0][1].body))).toEqual({
    name: 'Nile View Hotel', address: '12 Corniche', cityId: 'CAI',
    description: 'Near the river', starRating: 4, amenities: ['Wifi', 'Pool', 'Gym'],
  });
  expect(await screen.findByRole('table', { name: 'Hotels' })).toBeVisible();
});

it.each([
  [409, 'A hotel with this name already exists in this city', undefined, 'Hotel name'],
  [400, 'cityId must be a seeded city id', 'cityId', 'City'],
  [400, 'Invalid amenity', 'amenities.0', 'Amenities (optional)'],
])('maps hotel status %s to the correct field', async (status, message, detail, field) => {
  http.mockImplementation(async (url) => url === '/api/hotels' ? error(status, message, detail ? [{ field: detail, message }] : undefined) : fixture(url));
  mount();
  openHotelForm();
  await fillHotel();
  click('Create hotel');
  expect(await screen.findByText(message)).toBeVisible();
  const fieldElement = screen.getByRole(field === 'City' ? 'combobox' : 'textbox', { name: field });
  expect(fieldElement).toHaveAccessibleDescription(expect.stringContaining(message));
});

it.each(['network', 'server'])('refreshes after an uncertain %s creation failure and does not replay it', async (kind) => {
  http.mockImplementation(async (url) => {
    if (url !== '/api/airlines') return fixture(url);
    if (kind === 'network') throw new TypeError('offline');
    return error(500, 'possibly completed');
  });
  mount();
  await screen.findByText('Example Air');
  click('Create provider');
  fillAirline();
  click('Create airline');
  expect(await screen.findByText(/may have been created/)).toBeVisible();
  await waitFor(() => expect(calls().filter((url) => url.includes('type=airline'))).toHaveLength(2));
  expect(mutations('POST')).toHaveLength(1);
});

it.each([
  ['Deactivate', firstAirline, false, 'Provider deactivated.'],
  ['Reactivate', secondAirline, true, 'Provider reactivated.'],
] as const)('requires confirmation to %s and refreshes only after one mutation', async (action, provider, isActive, message) => {
  const patch = deferred();
  let updated = false;
  http.mockImplementation(async (url, request) => {
    if (request.method === 'PATCH') return patch.promise;
    return updated ? envelope([{ ...provider, isActive }]) : fixture(url);
  });
  mount();
  const rowAction = await screen.findByRole('button', { name: `${action} ${provider.name}` });
  fireEvent.click(rowAction);
  expect(screen.getByRole('alertdialog', { name: `${action} ${provider.name}?` })).toBeVisible();
  expect(mutations('PATCH')).toHaveLength(0);
  click('Cancel');
  expect(mutations('PATCH')).toHaveLength(0);
  await waitFor(() => expect(rowAction).toBeEnabled());
  fireEvent.click(rowAction);
  const confirm = screen.getByRole('button', { name: `${action} provider` });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mutations('PATCH')).toHaveLength(1);
  expect(mutations('PATCH')[0][0]).toBe(`/api/admin/providers/airline/${provider.id}/${action.toLowerCase()}`);
  expect(mutations('PATCH')[0][1].body).toBeUndefined();
  expect(confirm).toBeDisabled();
  expect(within(rowAction.closest('tr')!).getByText(provider.isActive ? 'Active' : 'Inactive')).toBeVisible();
  updated = true;
  await act(async () => patch.resolve(Response.json({ id: provider.id, type: 'airline', isActive })));
  expect(await screen.findByText(message)).toBeVisible();
  expect(await screen.findByRole('button', { name: `${isActive ? 'Deactivate' : 'Reactivate'} ${provider.name}` })).toBeEnabled();
  expect(calls().filter((url) => url.includes('?type=airline'))).toHaveLength(2);
});

it.each([409, 500, 'network'] as const)('reconciles a %s status failure without repeating or reversing the PATCH', async (status) => {
  let updated = false;
  http.mockImplementation(async (url, request) => {
    if (request.method !== 'PATCH') return updated ? envelope([{ ...hotel, isActive: false }]) : fixture(url);
    updated = true;
    if (status === 'network') throw new TypeError('offline');
    return error(status, status === 409 ? 'Already deactivated' : 'fixture failure');
  });
  mount();
  chooseType('hotel');
  fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Example Hotel' }));
  click('Deactivate provider');
  expect(await screen.findByText(status === 409 ? 'Already deactivated' : /status may have changed/)).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Reactivate Example Hotel' })).toBeEnabled();
  expect(mutations('PATCH')).toHaveLength(1);
  expect(mutations('PATCH')[0][0]).toBe(`/api/admin/providers/hotel/${hotel.id}/deactivate`);
});
