import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CabinClass, IsCalendarDate } from '../../common';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ExtraBagDto {
  @ApiProperty({
    example: 18.5,
    minimum: 0.01,
    description: 'Weight of this extra bag in kilograms',
  })
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'weightKg must be a number with at most 2 decimal places' },
  )
  @Min(0.01, { message: 'weightKg must be greater than 0' })
  weightKg: number;
}

export class BookingPassengerDto {
  @ApiProperty({ example: 'Amina Example', maxLength: 200 })
  @Transform(trim)
  @IsString({ message: 'fullName must be a string' })
  @IsNotEmpty({ message: 'fullName is required' })
  @MaxLength(200, { message: 'fullName must be at most 200 characters' })
  fullName: string;

  @ApiProperty({
    example: '2010-05-21',
    description: 'Date of birth in YYYY-MM-DD format',
  })
  @IsCalendarDate()
  dateOfBirth: string;

  @ApiProperty({
    example: 'P1234567',
    maxLength: 50,
    description: 'Passport or other government-issued ID number',
  })
  @Transform(trim)
  @IsString({ message: 'passportOrIdNumber must be a string' })
  @IsNotEmpty({ message: 'passportOrIdNumber is required' })
  @MaxLength(50, {
    message: 'passportOrIdNumber must be at most 50 characters',
  })
  passportOrIdNumber: string;

  @ApiPropertyOptional({
    type: [ExtraBagDto],
    description:
      'Optional extra bags for this passenger; each bag is weighed separately',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray({ message: 'extraBags must be an array' })
  @ArrayMaxSize(10, { message: 'extraBags must contain at most 10 bags' })
  @ValidateNested({ each: true })
  @Type(() => ExtraBagDto)
  extraBags?: ExtraBagDto[];
}

/** Body of POST /api/flight-bookings (FLT-19). Passenger counts and types are derived by the server. */
export class CreateFlightBookingDto {
  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d0e',
    description:
      'One-way flight id. For a round trip, provide two segments instead.',
    required: false,
  })
  @IsOptional()
  @Transform(trim)
  @IsMongoId({ message: 'flightId must be a valid id' })
  flightId?: string;

  @ApiProperty({
    enum: CabinClass,
    example: CabinClass.ECONOMY,
    required: false,
  })
  @IsOptional()
  @IsEnum(CabinClass, {
    message:
      'cabinClass must be one of: ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST',
  })
  cabinClass?: CabinClass;

  @ApiPropertyOptional({
    type: () => [CreateFlightBookingSegmentDto],
    minItems: 2,
    maxItems: 2,
    description:
      'Outbound then return flight. Each segment may use a different cabin class.',
  })
  @IsOptional()
  @IsArray({ message: 'segments must be an array' })
  @ArrayMinSize(2, { message: 'segments must contain outbound and return legs' })
  @ArrayMaxSize(2, { message: 'segments must contain exactly two legs' })
  @ValidateNested({ each: true })
  @Type(() => CreateFlightBookingSegmentDto)
  segments?: CreateFlightBookingSegmentDto[];

  @ApiProperty({ type: [BookingPassengerDto], minItems: 1, maxItems: 300 })
  @IsArray({ message: 'passengers must be an array' })
  @ArrayMinSize(1, { message: 'at least one passenger is required' })
  @ArrayMaxSize(300, { message: 'passengers must contain at most 300 people' })
  @ValidateNested({ each: true })
  @Type(() => BookingPassengerDto)
  passengers: BookingPassengerDto[];
}

export class CreateFlightBookingSegmentDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  @Transform(trim)
  @IsMongoId({ message: 'flightId must be a valid id' })
  flightId: string;

  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass, {
    message:
      'cabinClass must be one of: ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST',
  })
  cabinClass: CabinClass;
}
