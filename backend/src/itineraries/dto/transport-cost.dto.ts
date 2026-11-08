import { ApiProperty } from '@nestjs/swagger';
import {
  TransportCostLean,
  TransportMode,
} from '../schemas/transport-cost.schema';

export class TransportCostDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d30' })
  id: string;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  itineraryId: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d10',
    description: 'The day (of this itinerary) the trip is on',
  })
  dayId: string;

  @ApiProperty({ enum: TransportMode, example: TransportMode.TRAIN })
  mode: TransportMode;

  @ApiProperty({
    example: 'cairo',
    description: 'Official city_id of the departure city',
  })
  fromCityId: string;

  @ApiProperty({
    example: 'luxor',
    description: 'Official city_id of the arrival city',
  })
  toCityId: string;

  @ApiProperty({
    example: 18000,
    description: 'Cost in integer cents of `currency`. 0 is allowed.',
  })
  amountCents: number;

  @ApiProperty({ example: 'EGP', description: 'A supported currency code' })
  currency: string;
}

/** Response DTO, never the raw document: `_id` becomes `id` and ids are strings. */
export function toTransportCostDto(doc: TransportCostLean): TransportCostDto {
  return {
    id: doc._id.toString(),
    itineraryId: doc.itineraryId.toString(),
    dayId: doc.dayId.toString(),
    mode: doc.mode,
    fromCityId: doc.fromCityId,
    toCityId: doc.toCityId,
    amountCents: doc.amountCents,
    currency: doc.currency,
  };
}
