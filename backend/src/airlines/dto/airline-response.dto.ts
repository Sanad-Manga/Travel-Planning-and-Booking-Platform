import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AirlineLean } from '../schemas/airline.schema';

export class AirlineResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  id: string;

  @ApiProperty({ example: 'EgyptAir' })
  name: string;

  @ApiProperty({ example: 'MS' })
  code: string;

  @ApiPropertyOptional({ example: 'https://example.com/logos/ms.png' })
  logoUrl?: string;

  @ApiProperty({
    example: true,
    description: 'false when an admin deactivated the airline',
  })
  isActive: boolean;

  @ApiProperty({ example: '2026-11-04T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-04T10:00:00.000Z' })
  updatedAt: string;
}

/** Response DTO, never the raw document: `_id` becomes `id` and `__v` is not exposed. */
export function toAirlineResponse(doc: AirlineLean): AirlineResponseDto {
  return {
    id: doc._id.toString(),
    name: doc.name,
    code: doc.code,
    ...(doc.logoUrl ? { logoUrl: doc.logoUrl } : {}),
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
