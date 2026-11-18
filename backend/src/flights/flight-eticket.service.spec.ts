import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  FlightStatus,
  PassengerType,
} from '../common';
import { FlightETicketService } from './flight-eticket.service';
import {
  FlightBookingLean,
  FlightBookingSegment,
} from './schemas/flight-booking.schema';
import { FlightLean } from './schemas/flight.schema';

function flight(overrides: Partial<FlightLean> = {}): FlightLean {
  return {
    _id: new Types.ObjectId(),
    airlineId: new Types.ObjectId(),
    flightNumber: 'MS777',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureAt: new Date('2090-12-01T12:30:00.000Z'),
    arrivalAt: new Date('2090-12-01T17:45:00.000Z'),
    departureTimeZone: 'UTC',
    arrivalTimeZone: 'UTC',
    departureLocalDate: '2090-12-01',
    status: FlightStatus.SCHEDULED,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function segment(
  source: FlightLean,
  cabinClass: CabinClass,
  seats: number,
): FlightBookingSegment {
  return {
    flightId: source._id,
    airlineId: source.airlineId,
    cabinClass,
    seats,
    farePerPassengerCents: 45000,
    infantFareCents: 4500,
    baggageFeeCents: 0,
  };
}

function booking(
  overrides: Partial<FlightBookingLean> = {},
): FlightBookingLean {
  return {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    airlineId: new Types.ObjectId(),
    flightId: new Types.ObjectId(),
    cabinClass: CabinClass.ECONOMY,
    passengerCounts: { adults: 1, children: 0, infants: 0 },
    seats: 1,
    farePerPassengerCents: 45000,
    infantFareCents: 4500,
    totalCents: 45000,
    baggageFeeCents: 0,
    currency: 'USD',
    status: BookingStatus.CONFIRMED,
    paymentRef: 'pi_test',
    bookingReference: 'FLT-9F2C41A7B3D84E60',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('FlightETicketService (FLT-23)', () => {
  const service = new FlightETicketService();
  const issuedAt = new Date('2026-11-18T10:00:00.000Z');

  it('shapes both legs of a round trip, outbound first', () => {
    const outbound = flight();
    const returning = flight({
      flightNumber: 'BB778',
      departureAirport: 'JFK',
      arrivalAirport: 'CAI',
      departureAt: new Date('2090-12-02T10:00:00.000Z'),
      arrivalAt: new Date('2090-12-02T18:30:00.000Z'),
    });
    const data = service.buildData(
      booking({
        segments: [
          segment(outbound, CabinClass.ECONOMY, 2),
          segment(returning, CabinClass.BUSINESS, 2),
        ],
      }),
      [outbound, returning],
      issuedAt,
    );

    expect(data.bookingReference).toBe('FLT-9F2C41A7B3D84E60');
    expect(data.issuedAt).toBe(issuedAt.toISOString());
    expect(data.segments).toEqual([
      {
        flightNumber: 'MS777',
        departureAirport: 'CAI',
        arrivalAirport: 'JFK',
        departureLocal: '2090-12-01T12:30:00+00:00',
        arrivalLocal: '2090-12-01T17:45:00+00:00',
        cabinClass: CabinClass.ECONOMY,
        seats: 2,
      },
      {
        flightNumber: 'BB778',
        departureAirport: 'JFK',
        arrivalAirport: 'CAI',
        departureLocal: '2090-12-02T10:00:00+00:00',
        arrivalLocal: '2090-12-02T18:30:00+00:00',
        cabinClass: CabinClass.BUSINESS,
        seats: 2,
      },
    ]);
  });

  it('still supports a legacy one-way booking without a segments array', () => {
    const outbound = flight();
    const data = service.buildData(
      booking({
        segments: undefined,
        flightId: outbound._id,
        airlineId: outbound.airlineId,
        cabinClass: CabinClass.PREMIUM_ECONOMY,
        seats: 3,
      }),
      [outbound],
      issuedAt,
    );

    expect(data.segments).toHaveLength(1);
    expect(data.segments[0]).toMatchObject({
      flightNumber: 'MS777',
      cabinClass: CabinClass.PREMIUM_ECONOMY,
      seats: 3,
    });
  });

  it('lists passenger names and types without identity-document numbers', () => {
    const outbound = flight();
    const data = service.buildData(
      booking({
        passengers: [
          {
            fullName: 'Amina Example',
            dateOfBirth: '1990-01-01',
            passportOrIdNumber: 'P1234567',
            passengerType: PassengerType.ADULT,
            extraBags: [],
            baggageFeeCents: 0,
          },
        ],
      }),
      [outbound],
      issuedAt,
    );

    expect(data.passengers).toEqual([
      { fullName: 'Amina Example', passengerType: PassengerType.ADULT },
    ]);
    expect(JSON.stringify(data)).not.toContain('P1234567');
  });

  it('renders a real PDF buffer', async () => {
    const outbound = flight();
    const pdf = await service.render(
      service.buildData(booking(), [outbound], issuedAt),
    );

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });
});
