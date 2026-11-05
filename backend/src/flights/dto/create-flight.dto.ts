import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const LOCAL_TIME_RULE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Body of POST /api/flights.
 * The airline is NOT in the body: it is the moderator's own airline, taken from their login.
 * UTC times, status and ids are set by the server.
 */
export class CreateFlightDto {
  @ApiProperty({
    example: 'MS777',
    description: '2-3 letters/digits for the airline, then 1-4 digits.',
  })
  @Transform(trimUpper)
  @IsString({ message: 'flightNumber must be a string' })
  @Matches(/^[A-Z0-9]{2,3}\d{1,4}$/, {
    message:
      'flightNumber must be 2-3 letters or digits followed by 1-4 digits (e.g. MS777)',
  })
  flightNumber: string;

  @ApiProperty({
    example: 'CAI',
    description: 'IATA code of a seeded airport (GET /api/airports).',
  })
  @Transform(trimUpper)
  @IsString({ message: 'departureAirport must be a string' })
  @Matches(/^[A-Z]{3}$/, {
    message: 'departureAirport must be a 3-letter IATA code',
  })
  departureAirport: string;

  @ApiProperty({
    example: 'JFK',
    description: 'IATA code of a seeded airport.',
  })
  @Transform(trimUpper)
  @IsString({ message: 'arrivalAirport must be a string' })
  @Matches(/^[A-Z]{3}$/, {
    message: 'arrivalAirport must be a 3-letter IATA code',
  })
  arrivalAirport: string;

  @ApiProperty({
    example: '2026-12-01T14:30',
    description:
      'Departure in the LOCAL time of the departure airport, no offset or "Z" (YYYY-MM-DDTHH:mm).',
  })
  @Transform(trim)
  @IsString({ message: 'departureLocalTime must be a string' })
  @Matches(LOCAL_TIME_RULE, {
    message:
      'departureLocalTime must be a local date-time like 2026-12-01T14:30 (no time zone suffix)',
  })
  departureLocalTime: string;

  @ApiProperty({
    example: '2026-12-01T19:45',
    description:
      'Arrival in the LOCAL time of the arrival airport, no offset or "Z" (YYYY-MM-DDTHH:mm).',
  })
  @Transform(trim)
  @IsString({ message: 'arrivalLocalTime must be a string' })
  @Matches(LOCAL_TIME_RULE, {
    message:
      'arrivalLocalTime must be a local date-time like 2026-12-01T19:45 (no time zone suffix)',
  })
  arrivalLocalTime: string;
}
