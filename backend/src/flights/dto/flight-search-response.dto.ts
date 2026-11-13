import { ApiProperty } from '@nestjs/swagger';
import { CabinClass, PLATFORM_CURRENCY, utcToLocal } from '../../common';
import { FlightLean } from '../schemas/flight.schema';
import { CabinOption } from '../flight-cabins.reader';

export class SearchAirlineDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' }) id: string;
  @ApiProperty({ example: 'EgyptAir' }) name: string;
  @ApiProperty({ example: 'MS' }) code: string;
}

export class CabinOptionDto {
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  cabinClass: CabinClass;
  @ApiProperty({ example: 45000, description: 'Per-passenger fare in minor units' })
  priceCents: number;
  @ApiProperty({ example: 12, description: 'total - booked - held' })
  availableSeats: number;
}

export class FlightSearchItemDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' }) id: string;
  @ApiProperty({ example: 'MS777' }) flightNumber: string;
  @ApiProperty({ type: SearchAirlineDto }) airline: SearchAirlineDto;
  @ApiProperty({ example: 'CAI' }) departureAirport: string;
  @ApiProperty({ example: 'JFK' }) arrivalAirport: string;
  @ApiProperty({ example: '2026-12-01T12:30:00.000Z', description: 'UTC' })
  departureAt: string;
  @ApiProperty({ example: '2026-12-02T00:45:00.000Z', description: 'UTC' })
  arrivalAt: string;
  @ApiProperty({ example: '2026-12-01T14:30:00+02:00', description: 'Departure in the departure airport local time (GEN-06)' })
  departureLocal: string;
  @ApiProperty({ example: '2026-12-01T19:45:00-05:00', description: 'Arrival in the arrival airport local time (GEN-06)' })
  arrivalLocal: string;
  @ApiProperty({ example: 'Africa/Cairo' }) departureTimeZone: string;
  @ApiProperty({ example: 'America/New_York' }) arrivalTimeZone: string;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ type: [CabinOptionDto], description: 'Cabins with enough seats, cheapest first' })
  cabins: CabinOptionDto[];
}

export class FlightSearchPageDto {
  @ApiProperty({ type: [FlightSearchItemDto] }) items: FlightSearchItemDto[];
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export function toFlightSearchItem(
  flight: FlightLean,
  airline: SearchAirlineDto,
  cabins: CabinOption[],
): FlightSearchItemDto {
  return {
    id: flight._id.toString(),
    flightNumber: flight.flightNumber,
    airline,
    departureAirport: flight.departureAirport,
    arrivalAirport: flight.arrivalAirport,
    departureAt: flight.departureAt.toISOString(),
    arrivalAt: flight.arrivalAt.toISOString(),
    departureLocal: utcToLocal(flight.departureAt, flight.departureTimeZone),
    arrivalLocal: utcToLocal(flight.arrivalAt, flight.arrivalTimeZone),
    departureTimeZone: flight.departureTimeZone,
    arrivalTimeZone: flight.arrivalTimeZone,
    currency: PLATFORM_CURRENCY,
    cabins,
  };
}