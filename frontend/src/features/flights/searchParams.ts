import { withQuery } from '@/api/types';
import type {
  FlightCabinClass,
  FlightSearchQuery,
  FlightSortBy,
  FlightSortOrder,
} from '@/api/flights';

/**
 * FLT-11 / FLT-12 / FLT-15: the search criteria live in the address bar, so a search can be shared,
 * reloaded and reached with the browser's Back button. This module is the one place that reads and
 * writes them, which keeps the page component about the screen and the rules testable on their own.
 */

export const CABIN_CLASSES = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;

export const CABIN_LABELS: Record<FlightCabinClass, string> = {
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'Premium economy',
  BUSINESS: 'Business',
  FIRST: 'First',
};

export const SORT_OPTIONS: ReadonlyArray<{ value: string; sort: FlightSortBy; order: FlightSortOrder; label: string }> = [
  { value: 'departureTime:asc', sort: 'departureTime', order: 'asc', label: 'Earliest departure' },
  { value: 'departureTime:desc', sort: 'departureTime', order: 'desc', label: 'Latest departure' },
  { value: 'price:asc', sort: 'price', order: 'asc', label: 'Lowest price' },
  { value: 'price:desc', sort: 'price', order: 'desc', label: 'Highest price' },
  { value: 'duration:asc', sort: 'duration', order: 'asc', label: 'Shortest duration' },
  { value: 'duration:desc', sort: 'duration', order: 'desc', label: 'Longest duration' },
];

export const DEFAULT_SORT: FlightSortBy = 'departureTime';
export const DEFAULT_ORDER: FlightSortOrder = 'asc';
/** Ten per page, the same default as the rest of the app (contracts.md section 3). */
export const PAGE_SIZE = 10;

/** The controlled fields of the search form. Inputs are strings; the parser turns them into API values. */
export interface SearchFormValues {
  departureAirport: string;
  arrivalAirport: string;
  departureDate: string;
  returnDate: string;
  passengers: string;
  cabinClass: string;
}

export type SearchFormErrors = Partial<Record<keyof SearchFormValues, string>>;

/** The filters that refine an existing result set, separate from the form that starts a new search. */
export interface SearchFilters {
  minPrice?: number;
  maxPrice?: number;
  sort: FlightSortBy;
  order: FlightSortOrder;
  page: number;
}

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function read(params: URLSearchParams, key: string): string {
  return (params.get(key) ?? '').trim();
}

export function isRealDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isCabinClass(value: string): value is FlightCabinClass {
  return (CABIN_CLASSES as readonly string[]).includes(value);
}

function isSortBy(value: string): value is FlightSortBy {
  return value === 'price' || value === 'duration' || value === 'departureTime';
}

function isSortOrder(value: string): value is FlightSortOrder {
  return value === 'asc' || value === 'desc';
}

export function readSearchForm(params: URLSearchParams): SearchFormValues {
  const cabin = read(params, 'cabinClass').toUpperCase();
  return {
    departureAirport: read(params, 'departureAirport').toUpperCase(),
    arrivalAirport: read(params, 'arrivalAirport').toUpperCase(),
    departureDate: read(params, 'departureDate'),
    returnDate: read(params, 'returnDate'),
    passengers: read(params, 'passengers'),
    cabinClass: isCabinClass(cabin) ? cabin : '',
  };
}

/** Client-side checks first, with the same rules the backend applies (FlightSearchQueryDto + service). */
export function validateSearchForm(values: SearchFormValues): SearchFormErrors {
  const errors: SearchFormErrors = {};
  const departure = values.departureAirport.trim().toUpperCase();
  const arrival = values.arrivalAirport.trim().toUpperCase();

  if (!IATA.test(departure)) errors.departureAirport = 'Choose a departure airport.';
  if (!IATA.test(arrival)) errors.arrivalAirport = 'Choose an arrival airport.';
  else if (IATA.test(departure) && arrival === departure) {
    errors.arrivalAirport = 'Choose an arrival airport different from the departure airport.';
  }

  if (!values.departureDate) errors.departureDate = 'Choose a departure date.';
  else if (!isRealDate(values.departureDate)) errors.departureDate = 'Choose a real calendar date.';

  if (values.returnDate) {
    if (!isRealDate(values.returnDate)) errors.returnDate = 'Choose a real calendar date.';
    else if (values.departureDate && isRealDate(values.departureDate) && values.returnDate < values.departureDate) {
      errors.returnDate = 'The return date must be on or after the departure date.';
    }
  }

  const passengers = Number(values.passengers);
  if (!values.passengers.trim()) errors.passengers = 'Enter how many passengers are travelling.';
  else if (!/^\d+$/.test(values.passengers.trim()) || !Number.isSafeInteger(passengers) || passengers < 1) {
    errors.passengers = 'Passengers must be a whole number of 1 or more.';
  }

  if (values.cabinClass && !isCabinClass(values.cabinClass)) errors.cabinClass = 'Choose a valid cabin.';
  return errors;
}

function parsePrice(params: URLSearchParams, key: string): number | undefined {
  const text = read(params, key);
  if (!text || !/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parsePage(params: URLSearchParams): number {
  const text = read(params, 'page');
  if (!/^\d+$/.test(text)) return 1;
  const page = Number(text);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

export function readSearchFilters(params: URLSearchParams): SearchFilters {
  const sort = read(params, 'sort');
  const order = read(params, 'order');
  return {
    minPrice: parsePrice(params, 'minPrice'),
    maxPrice: parsePrice(params, 'maxPrice'),
    sort: isSortBy(sort) ? sort : DEFAULT_SORT,
    order: isSortOrder(order) ? order : DEFAULT_ORDER,
    page: parsePage(params),
  };
}

/**
 * The query for the API, or null while the address bar does not yet describe a complete search
 * (`/flights` on its own shows the prompt, not a request with missing fields).
 */
export function parseFlightSearchQuery(params: URLSearchParams): FlightSearchQuery | null {
  const form = readSearchForm(params);
  if (Object.keys(validateSearchForm(form)).length > 0) return null;
  return toFlightSearchQuery(form, readSearchFilters(params));
}

/** Turn a validated form (plus filters) into the exact query object the API and the URL both use. */
export function toFlightSearchQuery(values: SearchFormValues, filters: Partial<SearchFilters> = {}): FlightSearchQuery {
  const query: FlightSearchQuery = {
    departureAirport: values.departureAirport.trim().toUpperCase(),
    arrivalAirport: values.arrivalAirport.trim().toUpperCase(),
    departureDate: values.departureDate.trim(),
    passengers: Number(values.passengers.trim()),
    sort: filters.sort ?? DEFAULT_SORT,
    order: filters.order ?? DEFAULT_ORDER,
    page: filters.page ?? 1,
    limit: PAGE_SIZE,
  };
  if (values.returnDate.trim()) query.returnDate = values.returnDate.trim();
  if (values.cabinClass && isCabinClass(values.cabinClass)) query.cabinClass = values.cabinClass;
  if (filters.minPrice !== undefined) query.minPrice = filters.minPrice;
  if (filters.maxPrice !== undefined) query.maxPrice = filters.maxPrice;
  return query;
}

/** The /flights address that describes this search. */
export function buildSearchHref(query: FlightSearchQuery): string {
  return withQuery('/flights', query);
}

export function sortChoiceOf(sort: FlightSortBy, order: FlightSortOrder): string {
  return `${sort}:${order}`;
}

export function parseSortChoice(value: string): Pick<SearchFilters, 'sort' | 'order'> {
  const option = SORT_OPTIONS.find((candidate) => candidate.value === value);
  return option ? { sort: option.sort, order: option.order } : { sort: DEFAULT_SORT, order: DEFAULT_ORDER };
}

/** Dollars typed by a person to integer cents, the only amount format the backend accepts. Empty is undefined. */
export function priceInputToCents(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

/** The inverse for showing an existing filter in the box. */
export function centsToPriceInput(cents: number | undefined): string {
  if (cents === undefined || !Number.isInteger(cents)) return '';
  const amount = cents / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** "8h 15m" from the two UTC instants, so a time-zone crossing is still the real elapsed time. */
export function formatDuration(departureAt: string, arrivalAt: string): string {
  const minutes = Math.round((Date.parse(arrivalAt) - Date.parse(departureAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return '\u2014';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
}
