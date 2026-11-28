import { describe, expect, it } from 'vitest';
import { validateFlight, type FlightFormValues } from './flightForm';

const valid: FlightFormValues = {
  flightNumber: 'MS777',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureLocalTime: '2026-12-01T14:30',
  arrivalLocalTime: '2026-12-01T19:45',
};

describe('validateFlight (FLT-03)', () => {
  it('accepts a complete flight', () => {
    expect(validateFlight(valid)).toEqual({});
  });

  it('asks for every empty field', () => {
    const empty = { flightNumber: '', departureAirport: '', arrivalAirport: '', departureLocalTime: '', arrivalLocalTime: '' };
    expect(Object.keys(validateFlight(empty)).sort()).toEqual(Object.keys(empty).sort());
  });

  it.each(['M', 'MS', 'MS123456', 'ms 777', 'MS-777'])('rejects the flight number %s', (flightNumber) => {
    expect(validateFlight({ ...valid, flightNumber }).flightNumber).toMatch(/flight number/i);
  });

  it('accepts the flight number in lower case, since the backend upper-cases it', () => {
    expect(validateFlight({ ...valid, flightNumber: 'ms777' })).toEqual({});
  });

  it('rejects the same airport twice', () => {
    expect(validateFlight({ ...valid, arrivalAirport: 'CAI' }).arrivalAirport).toMatch(/different/i);
  });
});
