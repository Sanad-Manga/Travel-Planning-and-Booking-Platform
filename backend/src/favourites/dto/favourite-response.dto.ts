import { ApiProperty } from '@nestjs/swagger';
import { FavouriteType } from '../schemas/favourite.schema';

/** One saved item (BON-02). */
export class FavouriteDto {
  @ApiProperty({ example: '6740a1f2c3d4e5f607182901', description: 'Id of this favourite (use it to remove it).' })
  id: string;

  @ApiProperty({ enum: FavouriteType })
  type: FavouriteType;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e', description: 'The hotel id or itinerary id.' })
  itemId: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Nile View Hotel',
    description: 'Hotel name or itinerary title; null when the item is no longer available.',
  })
  name: string | null;

  @ApiProperty({
    example: true,
    description:
      'false when the hotel was deactivated or deleted, or the itinerary is no longer public (private, hidden, deleted or its author not active).',
  })
  available: boolean;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  addedAt: string;
}
