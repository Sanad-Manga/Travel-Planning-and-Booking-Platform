import { describe, expect, it } from 'vitest';
import {
  buildSearchHref,
  centsToPriceInput,
  formatDuration,
  parseFlightSearchQuery,
  parseSortChoice,
  priceInputToCents,
  readSearchForm,
  readSearchFilters,
  sortChoiceOf,
  toFlightSearchQuery,
  validateSearchForm,
  type SearchFormValues,
} from './searchParams';

const form: SearchFormValues = {
  departureAirport: 'cai',
  arrivalAirport: 'jfk',
  departureDate: '2026-12-01',
  returnDate: '',
  passengers: '2',
  cabinClass: 'ECONOMY',
};

describe('flight search URL and form rules (FLT-11, FLT-12, FLT-15)', () => {
  it('reads the form back from a search URL', () => {
    const params = new URLSearchParams('departureAirport=cai&arrivalAirport=JFK&departureDate=2026-12-01&passengers=2&cabinClass=BUSINESS');
    expect(readSearchForm(params)).toEqual({
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureDate: '2026-12-01',
      returnDate: '',
      passengers: '2',
      cabinClass: 'BUSINESS',
    });
  });

  it('checks the required fields before a search is sent', () => {
    const errors = validateSearchForm({
      departureAirport: '',
      arrivalAirport: '',
      departureDate: '',
      returnDate: '',
      passengers: '',
      cabinClass: '',
    });
    expect(errors).toEqual({
      departureAirport: 'Choose a departure airport.',
      arrivalAirport: 'Choose an arrival airport.',
      departureDate: 'Choose a departure date.',
      passengers: 'Enter how many passengers are travelling.',
    });
  });

  it('rejects the same airport, an impossible date and a return before departure', () => {
    expect(
      validateSearchForm({ ...form, arrivalAirport: 'CAI' }),
    ).toMatchObject({ arrivalAirport: 'Choose an arrival airport different from the departure airport.' });

    expect(validateSearchForm({ ...form, departureDate: '2026-02-30' })).toMatchObject({
      departureDate: 'Choose a real calendar date.',
    });

    expect(validateSearchForm({ ...form, departureDate: '2026-12-08', returnDate: '2026-12-01' })).toMatchObject({
      returnDate: 'The return date must be on or after the departure date.',
    });
  });

  it('accepts whole passengers only', () => {
    expect(validateSearchForm({ ...form, passengers: '0' })).toMatchObject({ passengers: 'Passengers must be a whole number of 1 or more.' });
    expect(validateSearchForm({ ...form, passengers: '1.5' })).toMatchObject({ passengers: 'Passengers must be a whole number of 1 or more.' });
    expect(validateSearchForm({ ...form, passengers: '3' })).toEqual({});
  });

  it('turns a valid form into the query the API and URL share', () => {
    const query = toFlightSearchQuery(form, { sort: 'price', order: 'asc', minPrice: 40000, maxPrice: 90000 });
    expect(query).toEqual({
      departureAirport: 'CAI',
      arrivalAirport: 'JFK',
      departureDate: '2026-12-01',
      passengers: 2,
      cabinClass: 'ECONOMY',
      minPrice: 40000,
      maxPrice: 90000,
      sort: 'price',
      order: 'asc',
      page: 1,
      limit: 10,
    });
    expect(buildSearchHref(query)).toBe(
      '/flights?departureAirport=CAI&arrivalAirport=JFK&departureDate=2026-12-01&passengers=2&sort=price&order=asc&page=1&limit=10&cabinClass=ECONOMY&minPrice=40000&maxPrice=90000',
    );
  });

  it('parses a round-trip URL and ignores an incomplete one', () => {
    const params = new URLSearchParams(
      'departureAirport=CAI&arrivalAirport=JFK&departureDate=2026-12-01&returnDate=2026-12-08&passengers=1&sort=duration&order=desc&page=2',
    );
    expect(parseFlightSearchQuery(params)).toMatchObject({
      returnDate: '2026-12-08',
      sort: 'duration',
      order: 'desc',
      page: 2,
      limit: 10,
    });
    expect(parseFlightSearchQuery(new URLSearchParams('departureAirport=CAI'))).toBeNull();
    expect(
      parseFlightSearchQuery(
        new URLSearchParams('departureAirport=CAI&arrivalAirport=JFK&departureDate=2026-02-30&passengers=1'),
      ),
    ).toBeNull();
  });

  it('reads filters with safe defaults', () => {
    expect(readSearchFilters(new URLSearchParams('minPrice=40000&maxPrice=90000&sort=price&page=3'))).toEqual({
      minPrice: 40000,
      maxPrice: 90000,
      sort: 'price',
      order: 'asc',
      page: 3,
    });
    expect(readSearchFilters(new URLSearchParams('minPrice=-1&sort=unknown&order=sideways&page=0'))).toEqual({
      minPrice: undefined,
      maxPrice: undefined,
      sort: 'departureTime',
      order: 'asc',
      page: 1,
    });
  });

  it('converts typed prices to cents and back without floats', () => {
    expect(priceInputToCents('400')).toBe(40000);
    expect(priceInputToCents('400.5')).toBe(40050);
    expect(priceInputToCents('')).toBeUndefined();
    expect(priceInputToCents('-1')).toBeNull();
    expect(priceInputToCents('free')).toBeNull();
    expect(centsToPriceInput(40000)).toBe('400');
    expect(centsToPriceInput(40050)).toBe('400.50');
    expect(centsToPriceInput(undefined)).toBe('');
  });

  it('maps a sort choice and shows a duration across time zones', () => {
    expect(sortChoiceOf('price', 'desc')).toBe('price:desc');
    expect(parseSortChoice('duration:asc')).toEqual({ sort: 'duration', order: 'asc' });
    expect(parseSortChoice('nonsense')).toEqual({ sort: 'departureTime', order: 'asc' });
    expect(formatDuration('2026-12-01T12:30:00.000Z', '2026-12-01T20:45:00.000Z')).toBe('8h 15m');
    expect(formatDuration('2026-12-01T12:30:00.000Z', '2026-12-01T12:45:00.000Z')).toBe('15m');
    expect(formatDuration('not-a-date', '2026-12-01T12:45:00.000Z')).toBe('\u2014');
  });
});
