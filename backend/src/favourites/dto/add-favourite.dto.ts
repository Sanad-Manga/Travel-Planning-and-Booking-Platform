import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { FavouriteType } from '../schemas/favourite.schema';

/** Body of POST /api/favourites (BON-02). */
export class AddFavouriteDto {
  @ApiProperty({ enum: FavouriteType, example: FavouriteType.HOTEL })
  @IsEnum(FavouriteType)
  type: FavouriteType;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e', description: 'The hotel id or the public itinerary id.' })
  @IsMongoId()
  itemId: string;
}
