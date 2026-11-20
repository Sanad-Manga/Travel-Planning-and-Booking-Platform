import { ApiProperty } from '@nestjs/swagger';
import { CabinClass, FlightStatus } from '../../common';

export class FlightDetailsAirlineDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' })
  id: string;

  @ApiProperty({ example: 'EgyptAir' })
  name: string;

  @ApiProperty({ example: 'MS' })
  code: string;
}

export class FlightDetailsAirportDto {
  @ApiProperty({ example: 'CAI' })
  iataCode: string;

  @ApiProperty({ example: 'Cairo International Airport' })
  name: string;

  @ApiProperty({ example: 'Africa/Cairo' })
  timeZone: string;
}

export class FlightCabinBaggageAllowanceDto {
  @ApiProperty({
    example: 1,
    description: 'Number of free checked bags per passenger',
  })
  freeBags: number;

  @ApiProperty({
    example: 23,
    description: 'Maximum weight in kilograms per bag',
  })
  maxBagWeightKg: number;
}

export class FlightDetailsCabinDto {
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  cabinClass: CabinClass;

  @ApiProperty({
    example: 45000,
    description: 'Per-passenger fare in integer cents',
  })
  priceCents: number;

  @ApiProperty({
    example: 12,
    description: 'totalSeats - bookedSeats - heldSeats',
  })
  availableSeats: number;

  @ApiProperty({ type: FlightCabinBaggageAllowanceDto })
  baggageAllowance: FlightCabinBaggageAllowanceDto;
}

export class FlightCancellationTierDto {
  @ApiProperty({
    example: 14,
    description: 'Minimum whole days before departure for this tier',
  })
  daysBeforeThreshold: number;

  @ApiProperty({ example: 100, description: 'Refund percentage for this tier' })
  refundPercent: number;
}

export class FlightCancellationPolicyDto {
  @ApiProperty({
    type: [FlightCancellationTierDto],
    description:
      'Largest days-before-departure threshold first; an empty list means no refunds',
  })
  cancellationTiers: FlightCancellationTierDto[];
}

export class FlightDetailsResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiProperty({ type: FlightDetailsAirlineDto })
  airline: FlightDetailsAirlineDto;

  @ApiProperty({ example: 'MS777' })
  flightNumber: string;

  @ApiProperty({ type: FlightDetailsAirportDto })
  departureAirport: FlightDetailsAirportDto;

  @ApiProperty({ type: FlightDetailsAirportDto })
  arrivalAirport: FlightDetailsAirportDto;

  @ApiProperty({
    example: '2026-12-01T12:30:00.000Z',
    description: 'UTC departure instant',
  })
  departureAt: string;

  @ApiProperty({
    example: '2026-12-01T14:30:00+02:00',
    description: 'Departure in the departure airport local time',
  })
  departureLocal: string;

  @ApiProperty({
    example: '2026-12-02T00:45:00.000Z',
    description: 'UTC arrival instant',
  })
  arrivalAt: string;

  @ApiProperty({
    example: '2026-12-01T19:45:00-05:00',
    description: 'Arrival in the arrival airport local time',
  })
  arrivalLocal: string;

  @ApiProperty({ example: 735, description: 'Elapsed flight time in minutes' })
  durationMinutes: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    enum: FlightStatus,
    example: FlightStatus.SCHEDULED,
    description:
      'SCHEDULED, CANCELLED or DEPARTED. A SCHEDULED flight whose departure time has passed is reported as DEPARTED. CANCELLED is only reported when it is already stored: cancelling a flight is a separate ticket (FLT-06) and this endpoint set does not do it. Only SCHEDULED flights are searchable, editable or bookable.',
  })
  status: FlightStatus;

  @ApiProperty({ type: [FlightDetailsCabinDto] })
  cabins: FlightDetailsCabinDto[];

  @ApiProperty({ type: FlightCancellationPolicyDto })
  cancellationPolicy: FlightCancellationPolicyDto;
}
