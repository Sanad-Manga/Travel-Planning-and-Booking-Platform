import { api } from '@/lib/api';
import { withQuery, type QueryOf, type ResponseOf, type Schema } from './types';

/**
 * FLT-11 / FLT-12 / FLT-15: the flight-search endpoint in one place, following the convention in
 * `referenceData.ts`. Types come from the generated Swagger document, so a backend change becomes a
 * TypeScript error here.
 */

export type FlightSearchQuery = QueryOf<'/api/flights/search'>;
export type FlightSearchResponse = ResponseOf<'/api/flights/search'>;
export type FlightSearchPage = Schema<'FlightSearchPageDto'>;
export type FlightSearchItem = Schema<'FlightSearchItemDto'>;
export type FlightCabinOption = Schema<'CabinOptionDto'>;
export type FlightRoundTripResponse = Schema<'FlightRoundTripSearchResponseDto'>;
export type FlightCabinClass = NonNullable<FlightSearchQuery['cabinClass']>;
export type FlightSortBy = NonNullable<FlightSearchQuery['sort']>;
export type FlightSortOrder = NonNullable<FlightSearchQuery['order']>;

/** The SWR cache key and the exact request path, including the query string. */
export const flightSearchKey = (query: FlightSearchQuery) => withQuery('/api/flights/search', query);

/** GET /api/flights/search (public; guests and registered users search the same way). */
export function searchFlights(query: FlightSearchQuery, signal?: AbortSignal): Promise<FlightSearchResponse> {
  return api<FlightSearchResponse>(flightSearchKey(query), { signal });
}

/** A round-trip answer has separate outbound and return pages; a one-way answer is a single page. */
export function isRoundTripResponse(response: FlightSearchResponse): response is FlightRoundTripResponse {
  return 'outbound' in response && 'return' in response;
}
