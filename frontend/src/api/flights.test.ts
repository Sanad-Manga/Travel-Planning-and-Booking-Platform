import { describe, expect, it } from 'vitest';
import {
  flightSearchKey,
  isRoundTripResponse,
  type FlightRoundTripResponse,
  type FlightSearchPage,
} from './flights';

const page: FlightSearchPage = { items: [], page: 1, limit: 10, total: 0, totalPages: 0 };
const roundTrip: FlightRoundTripResponse = { outbound: page, return: page };

describe('flight search API (FLT-11, FLT-12)', () => {
  it('builds the request key from the search criteria, skipping empty values', () => {
    expect(
      flightSearchKey({
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureDate: '2026-12-01',
        passengers: 2,
        sort: 'price',
        order: 'asc',
        page: 1,
        limit: 10,
      }),
    ).toBe('/api/flights/search?departureAirport=CAI&arrivalAirport=JFK&departureDate=2026-12-01&passengers=2&sort=price&order=asc&page=1&limit=10');
  });

  it('keeps the return date and optional filters in the key', () => {
    expect(
      flightSearchKey({
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureDate: '2026-12-01',
        returnDate: '2026-12-08',
        passengers: 1,
        cabinClass: 'ECONOMY',
        minPrice: 40000,
        maxPrice: 90000,
      }),
    ).toBe(
      '/api/flights/search?departureAirport=CAI&arrivalAirport=JFK&departureDate=2026-12-01&returnDate=2026-12-08&passengers=1&cabinClass=ECONOMY&minPrice=40000&maxPrice=90000',
    );
  });

  it('tells a round trip from a one-way answer', () => {
    expect(isRoundTripResponse(roundTrip)).toBe(true);
    expect(isRoundTripResponse(page)).toBe(false);
  });
});
