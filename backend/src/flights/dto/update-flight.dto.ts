import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateFlightDto } from './create-flight.dto';

/**
 * Body of PATCH /api/flights/:id (FLT-05): the same rules as creating a flight, all optional.
 * The flight number cannot change (it identifies the flight), so sending it is a 400.
 * Airports can only change while the flight has no active booking; the server checks that.
 */
export class UpdateFlightDto extends PartialType(
  OmitType(CreateFlightDto, ['flightNumber'] as const),
) {}
