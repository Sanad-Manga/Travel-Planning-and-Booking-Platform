import { ApiProperty } from '@nestjs/swagger';
import { CabinClass, PLATFORM_CURRENCY } from '../../common';
import { CabinLean } from '../schemas/cabin.schema';
import { availableSeats } from '../utils/seat-availability';

export class CabinResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0f' })
  id: string;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  flightId: string;

  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  cabinClass: CabinClass;

  @ApiProperty({ example: 180 })
  totalSeats: number;

  @ApiProperty({ example: 12, description: 'Seats of confirmed bookings' })
  bookedSeats: number;

  @ApiProperty({
    example: 2,
    description: 'Seats of unexpired holds waiting for payment',
  })
  heldSeats: number;

  @ApiProperty({ example: 166, description: 'total - booked - held' })
  availableSeats: number;

  @ApiProperty({
    example: 45000,
    description: 'Per-passenger fare in integer cents',
  })
  priceCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 1 })
  freeBags: number;

  @ApiProperty({ example: 23, description: 'kg per bag' })
  maxBagWeightKg: number;

  @ApiProperty({ example: '2026-11-11T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-11T10:00:00.000Z' })
  updatedAt: string;
}

/** Response DTO, never the raw document. */
export function toCabinResponse(doc: CabinLean): CabinResponseDto {
  return {
    id: doc._id.toString(),
    flightId: doc.flightId.toString(),
    cabinClass: doc.cabinClass,
    totalSeats: doc.totalSeats,
    bookedSeats: doc.bookedSeats,
    heldSeats: doc.heldSeats,
    availableSeats: availableSeats(doc),
    priceCents: doc.priceCents,
    currency: PLATFORM_CURRENCY,
    freeBags: doc.freeBags,
    maxBagWeightKg: doc.maxBagWeightKg,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
