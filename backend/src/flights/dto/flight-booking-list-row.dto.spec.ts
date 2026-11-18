import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  FlightStatus,
  PassengerType,
} from '../../common';
import { FlightBookingListRowSource, toFlightBookingListRow } from './flight-booking-list-row.dto';
import { FlightBookingSummarySegmentDto } from './flight-booking-summary-response.dto';
import { FlightResponseDto } from './flight-response.dto';
import { FlightBookingGroup } from './my-flight-bookings-query.dto';

function flightDoc(
  id: string,
  flightNumber: string,
  departureAirport: string,
  arrivalAirport: string,
): FlightResponseDto {
  return {
    id,
    airlineId: '674a1b2c3d4e5f6a7b8c9d01',
    flightNumber,
    departureAirport,
    arrivalAirport,
    departureAt: '2090-12-01T12:30:00.000Z',
    arrivalAt: '2090-12-01T17:45:00.000Z',
    departureLocal: '2090-12-01T14:30:00+02:00',
    arrivalLocal: '2090-12-01T12:45:00-05:00',
    departureTimeZone: 'Africa/Cairo',
    arrivalTimeZone: 'America/New_York',
    status: FlightStatus.SCHEDULED,
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
  };
}

function segment(
  flight: FlightResponseDto,
  cabinClass: CabinClass,
): FlightBookingSummarySegmentDto {
  return {
    flightId: flight.id,
    cabinClass,
    seats: 1,
    farePerPassengerCents: 45000,
    infantFareCents: 4500,
    baggageFeeCents: 0,
    flight,
  };
}

function booking(
  overrides: Partial<FlightBookingListRowSource> = {},
): FlightBookingListRowSource {
  return {
    _id: new Types.ObjectId('674a1b2c3d4e5f6a7b8c9d0f'),
    userId: new Types.ObjectId('674a1b2c3d4e5f6a7b8c9d10'),
    airlineId: new Types.ObjectId('674a1b2c3d4e5f6a7b8c9d01'),
    flightId: new Types.ObjectId('674a1b2c3d4e5f6a7b8c9d0e'),
    cabinClass: CabinClass.ECONOMY,
    passengerCounts: { adults: 1, children: 0, infants: 0 },
    passengers: [],
    seats: 1,
    farePerPassengerCents: 45000,
    infantFareCents: 4500,
    totalCents: 45000,
    baggageFeeCents: 0,
    currency: 'USD',
    status: BookingStatus.CONFIRMED,
    createdAt: new Date('2026-11-18T10:00:00.000Z'),
    updatedAt: new Date('2026-11-18T10:00:00.000Z'),
    group: FlightBookingGroup.UPCOMING,
    ...overrides,
  };
}

describe('toFlightBookingListRow (FLT-25)', () => {
  const outbound = flightDoc(
    '674a1b2c3d4e5f6a7b8c9d0e',
    'MS777',
    'CAI',
    'JFK',
  );
  const returning = flightDoc(
    '674a1b2c3d4e5f6a7b8c9d11',
    'BB778',
    'JFK',
    'CAI',
  );

  it('maps the group, reference, cabin, segments and total of a round trip', () => {
    const row = toFlightBookingListRow(
      booking({ bookingReference: 'FLT-ABCDEF0123456789' }),
      [segment(outbound, CabinClass.ECONOMY), segment(returning, CabinClass.BUSINESS)],
      outbound,
    );

    expect(row).toMatchObject({
      id: '674a1b2c3d4e5f6a7b8c9d0f',
      group: FlightBookingGroup.UPCOMING,
      bookingReference: 'FLT-ABCDEF0123456789',
      status: BookingStatus.CONFIRMED,
      cabinClass: CabinClass.ECONOMY,
      flight: { id: outbound.id, departureAirport: 'CAI' },
      passengerCounts: { adults: 1, children: 0, infants: 0 },
      totalCents: 45000,
      currency: 'USD',
      createdAt: '2026-11-18T10:00:00.000Z',
    });
    expect(row.segments.map((item) => item.flight.flightNumber)).toEqual([
      'MS777',
      'BB778',
    ]);
    expect(row.segments.map((item) => item.cabinClass)).toEqual([
      CabinClass.ECONOMY,
      CabinClass.BUSINESS,
    ]);
  });

  it('keeps a historical booking without a reference or segments readable', () => {
    const legacy = booking({ segments: undefined, group: FlightBookingGroup.PAST });

    const row = toFlightBookingListRow(
      legacy,
      [segment(outbound, CabinClass.ECONOMY)],
      outbound,
    );

    expect(row).not.toHaveProperty('bookingReference');
    expect(row.group).toBe(FlightBookingGroup.PAST);
    expect(row.segments).toHaveLength(1);
    expect(row.passengers).toEqual([]);
  });

  it('never exposes passport/identity numbers from stored passengers', () => {
    const row = toFlightBookingListRow(
      booking({
        passengers: [
          {
            fullName: 'Amina Example',
            dateOfBirth: '1978-12-01',
            passportOrIdNumber: 'P1234567',
            passengerType: PassengerType.ADULT,
            extraBags: [],
            baggageFeeCents: 0,
          },
        ],
      }),
      [segment(outbound, CabinClass.ECONOMY)],
      outbound,
    );

    expect(row.passengers[0]).toMatchObject({
      fullName: 'Amina Example',
      passengerType: PassengerType.ADULT,
    });
    expect(row.passengers[0]).not.toHaveProperty('passportOrIdNumber');
  });
});
