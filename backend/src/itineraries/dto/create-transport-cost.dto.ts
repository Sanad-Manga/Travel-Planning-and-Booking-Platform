import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TransportMode } from '../schemas/transport-cost.schema';

/** Safety cap on one transport cost (1 billion units of the currency), far above any real fare. */
export const TRANSPORT_COST_MAX_CENTS = 100_000_000_000;
/** Longer than any official city_id. Stops a huge string from reaching the lookup. */
const CITY_ID_MAX_LENGTH = 100;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimAndUpperCase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** The rules for a city field. Whether the city is in the seeded list is checked in the service. */
export const TransportCityRules = (field: string) =>
  applyDecorators(
    Transform(trim),
    IsString({ message: `${field} must be a string` }),
    IsNotEmpty({ message: `${field} should not be empty` }),
    MaxLength(CITY_ID_MAX_LENGTH, {
      message: `${field} must be at most ${CITY_ID_MAX_LENGTH} characters`,
    }),
  );

/** The rules for the currency: a 3-letter code, upper-cased. Whether it is supported is checked in the service. */
export const TransportCurrencyRules = () =>
  applyDecorators(
    Transform(trimAndUpperCase),
    Matches(/^[A-Z]{3}$/, {
      message: 'currency must be a 3-letter currency code, e.g. USD',
    }),
  );

/** The rules for the amount: a non-negative whole number of cents. */
export const TransportAmountRules = () =>
  applyDecorators(
    IsInt({ message: 'amountCents must be a whole number of cents' }),
    Min(0, { message: 'amountCents must not be negative' }),
    Max(TRANSPORT_COST_MAX_CENTS, {
      message: `amountCents must be at most ${TRANSPORT_COST_MAX_CENTS}`,
    }),
  );

export const TransportModeRules = () =>
  applyDecorators(
    IsEnum(TransportMode, {
      message: `mode must be one of: ${Object.values(TransportMode).join(', ')}`,
    }),
  );

export const TransportDayRules = () =>
  applyDecorators(IsMongoId({ message: 'dayId must be a valid id' }));

/**
 * Body of POST /api/itineraries/:id/transport-costs (ITN-16). Everything is required. The itinerary and the owner
 * come from the URL and the login, never from the body.
 */
export class CreateTransportCostDto {
  @ApiProperty({ enum: TransportMode, example: TransportMode.TRAIN })
  @TransportModeRules()
  mode: TransportMode;

  @ApiProperty({
    example: 'cairo',
    description: 'Official city_id of the departure city (seeded list)',
  })
  @TransportCityRules('fromCityId')
  fromCityId: string;

  @ApiProperty({
    example: 'luxor',
    description: 'Official city_id of the arrival city (seeded list)',
  })
  @TransportCityRules('toCityId')
  toCityId: string;

  @ApiProperty({
    example: 18000,
    minimum: 0,
    description: 'Cost in integer cents of `currency`. 0 is allowed.',
  })
  @TransportAmountRules()
  amountCents: number;

  @ApiProperty({
    example: 'EGP',
    description:
      'A supported currency code (the codes of the seeded countries); lower case is accepted',
  })
  @TransportCurrencyRules()
  currency: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d10',
    description: 'The day of this itinerary the trip is on',
  })
  @TransportDayRules()
  dayId: string;
}
