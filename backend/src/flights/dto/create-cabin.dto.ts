import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';
import { CabinClass } from '../../common';

/**
 * Body of POST /api/flights/:id/cabins.
 * The flight comes from the URL. Booked and held seat counters are never accepted: booking code owns them.
 */
export class CreateCabinDto {
  @ApiProperty({
    enum: CabinClass,
    example: CabinClass.ECONOMY,
    description:
      'One of the fixed set. Each class can be used once per flight.',
  })
  @IsEnum(CabinClass, {
    message: `cabinClass must be one of: ${Object.values(CabinClass).join(', ')}`,
  })
  cabinClass: CabinClass;

  @ApiProperty({
    example: 180,
    minimum: 1,
    description: 'Seats on sale (whole number > 0)',
  })
  @IsInt({ message: 'totalSeats must be a whole number' })
  @Min(1, { message: 'totalSeats must be greater than 0' })
  @Max(10000, { message: 'totalSeats must be at most 10000' })
  totalSeats: number;

  @ApiProperty({
    example: 45000,
    minimum: 1,
    description: 'Per-passenger fare in integer cents (> 0): 45000 = 450.00',
  })
  @IsInt({ message: 'priceCents must be a whole number of cents' })
  @Min(1, { message: 'priceCents must be greater than 0' })
  priceCents: number;

  @ApiProperty({
    example: 1,
    minimum: 0,
    description: 'Free checked bags per passenger (0 is allowed)',
  })
  @IsInt({ message: 'freeBags must be a whole number' })
  @Min(0, { message: 'freeBags must be 0 or more' })
  @Max(10, { message: 'freeBags must be at most 10' })
  freeBags: number;

  @ApiProperty({
    example: 23,
    description:
      'Maximum weight in kg of each bag (> 0). Extra bags (FLT-08) use the same limit.',
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'maxBagWeightKg must be a number with at most 2 decimals' },
  )
  @IsPositive({ message: 'maxBagWeightKg must be greater than 0' })
  @Max(100, { message: 'maxBagWeightKg must be at most 100' })
  maxBagWeightKg: number;
}
