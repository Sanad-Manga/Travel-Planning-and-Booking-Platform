import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { CabinClass } from '../../common';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Technical guard against absurd numbers, not a business rule. */
const MAX_PER_TYPE = 100;

/**
 * Body of POST /api/flight-bookings/hold (FLT-22).
 * The user, the price, the status and the expiry are NOT here: the server sets them.
 */
export class HoldFlightBookingDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e', description: 'Id of the flight (from the search results)' })
  @Transform(trim)
  @IsMongoId({ message: 'flightId must be a valid id' })
  flightId: string;

  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass, {
    message: 'cabinClass must be one of: ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST',
  })
  cabinClass: CabinClass;

  @ApiProperty({ example: 2, minimum: 1, description: 'Passengers aged 12 or more (at least 1)' })
  @Type(() => Number)
  @IsInt({ message: 'adults must be a whole number' })
  @Min(1, { message: 'at least 1 adult is required' })
  @Max(MAX_PER_TYPE, { message: `adults must be at most ${MAX_PER_TYPE}` })
  adults: number;

  @ApiPropertyOptional({ example: 1, minimum: 0, default: 0, description: 'Passengers aged 2 to 11' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'children must be a whole number' })
  @Min(0, { message: 'children must be 0 or more' })
  @Max(MAX_PER_TYPE, { message: `children must be at most ${MAX_PER_TYPE}` })
  children: number = 0;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    default: 0,
    description: 'Passengers under 2. They take no seat; at most one per adult.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'infants must be a whole number' })
  @Min(0, { message: 'infants must be 0 or more' })
  @Max(MAX_PER_TYPE, { message: `infants must be at most ${MAX_PER_TYPE}` })
  infants: number = 0;
}
