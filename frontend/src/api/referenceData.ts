import { api } from '@/lib/api';
import { withQuery } from './types';
import type { QueryOf, ResponseOf } from './types';

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
