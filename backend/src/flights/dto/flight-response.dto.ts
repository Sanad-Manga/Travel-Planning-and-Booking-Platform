import { ApiProperty } from '@nestjs/swagger';
import { FlightStatus, utcToLocal } from '../../common';
import { FlightLean } from '../schemas/flight.schema';

export class FlightResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' })
  airlineId: string;

  @ApiProperty({ example: 'MS777' })
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  departureAirport: string;

  @ApiProperty({ example: 'JFK' })
  arrivalAirport: string;

  @ApiProperty({ example: '2026-12-01T12:30:00.000Z', description: 'UTC' })
  departureAt: string;

  @ApiProperty({ example: '2026-12-02T00:45:00.000Z', description: 'UTC' })
  arrivalAt: string;

  @ApiProperty({
    example: '2026-12-01T14:30:00+02:00',
    description:
      'Departure in the LOCAL time of the departure airport (with its UTC offset)',
  })
  departureLocal: string;

  @ApiProperty({
    example: '2026-12-01T19:45:00-05:00',
    description:
      'Arrival in the LOCAL time of the arrival airport (with its UTC offset)',
  })
  arrivalLocal: string;

  @ApiProperty({
    example: 'Africa/Cairo',
    description: 'IANA zone of the departure airport, to show local time',
  })
  departureTimeZone: string;

  @ApiProperty({ example: 'America/New_York' })
  arrivalTimeZone: string;

  @ApiProperty({ enum: FlightStatus, example: FlightStatus.SCHEDULED })
  status: FlightStatus;

  @ApiProperty({ example: '2026-11-05T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-05T10:00:00.000Z' })
  updatedAt: string;
}

/** Response DTO, never the raw document: `_id` becomes `id`, ObjectIds become strings, `__v` is dropped. */
export function toFlightResponse(doc: FlightLean): FlightResponseDto {
  return {
    id: doc._id.toString(),
    airlineId: doc.airlineId.toString(),
    flightNumber: doc.flightNumber,
    departureAirport: doc.departureAirport,
    arrivalAirport: doc.arrivalAirport,
    departureAt: doc.departureAt.toISOString(),
    arrivalAt: doc.arrivalAt.toISOString(),
    departureLocal: utcToLocal(doc.departureAt, doc.departureTimeZone),
    arrivalLocal: utcToLocal(doc.arrivalAt, doc.arrivalTimeZone),
    departureTimeZone: doc.departureTimeZone,
    arrivalTimeZone: doc.arrivalTimeZone,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
