import { api } from '@/lib/api';
import { withQuery } from './types';
import type { Page, QueryOf, ResponseOf, Schema } from './types';

/**
 * GEN-02 example of the endpoint-function convention. Copy this file's shape for every backend module:
 *
 *  1. One file per backend module in `src/api/`, named after it (`referenceData.ts`, `flights.ts`, ...).
 *  2. One exported function per endpoint, named like the action (`listAirports`, `getMe`, `createBooking`).
 *  3. Types come from `./types` (generated from Swagger), never written by hand.
 *  4. Functions call `api()` from `@/lib/api` (cookies, refresh on 401, `ApiError`), never `fetch` directly.
 *  5. Components do not call these functions in render. Read data with `useApi` (`./useApi`); run actions
 *     (create, update, delete) from event handlers and show errors with `toFriendlyError` or `applyApiErrors`.
 */

export type AirportsPage = ResponseOf<'/api/airports'>;
export type AirportsQuery = QueryOf<'/api/airports'>;
export type CountriesPage = ResponseOf<'/api/countries'>;
export type CountriesQuery = QueryOf<'/api/countries'>;

/** The SWR cache key for a list: also what a component passes to `useApi`. */
export const airportsKey = (query?: AirportsQuery) => withQuery('/api/airports', query);
export const countriesKey = (query?: CountriesQuery) => withQuery('/api/countries', query);

export function listAirports(query?: AirportsQuery, signal?: AbortSignal): Promise<AirportsPage> {
  return api<AirportsPage>(airportsKey(query), { signal });
}

export function listCountries(query?: CountriesQuery, signal?: AbortSignal): Promise<CountriesPage> {
  return api<CountriesPage>(countriesKey(query), { signal });
}

// GEN-12 / FLT-02: item types used by the pickers.
export type Airport = Schema<'AirportResponseDto'>;
export type Country = Schema<'CountryResponseDto'>;
export type City = Schema<'CityResponseDto'>;
export type Currency = Schema<'CurrencyResponseDto'>;
export type CitiesQuery = QueryOf<'/api/cities'>;

/** The backend's maximum page size (docs/contracts.md: limit max 50). */
const MAX_LIMIT = 50;
/** Safety stop: never walk more than 1,000 items for one picker. */
const MAX_PAGES = 20;

/**
 * Loads every item of a small reference list (airports, cities, countries, currencies). The backend has no
 * search parameter, so a picker loads the whole list once (cached by SWR) and filters it in the browser.
 * Page 1 says how many pages exist; the rest are requested together.
 */
export async function listAll<T>(path: string, query?: object): Promise<T[]> {
  const pageKey = (page: number) => withQuery(path, { ...query, page, limit: MAX_LIMIT });
  const first = await api<Page<T>>(pageKey(1));
  const last = Math.min(first.totalPages, MAX_PAGES);
  const rest = await Promise.all(Array.from({ length: Math.max(last - 1, 0) }, (_, i) => api<Page<T>>(pageKey(i + 2))));
  return [first, ...rest].flatMap((p) => p.items);
}

/** SWR key for a whole list; the `all:` prefix keeps it apart from the single-page keys above. */
export const allKey = (path: string, query?: object) => `all:${withQuery(path, query)}`;

/** SWR fetcher for an `allKey`. */
export function fetchAll<T>(key: string): Promise<T[]> {
  const url = new URL(key.slice('all:'.length), 'http://local');
  return listAll<T>(url.pathname, Object.fromEntries(url.searchParams));
}
