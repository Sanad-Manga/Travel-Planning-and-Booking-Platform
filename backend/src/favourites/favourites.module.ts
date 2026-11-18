import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelsModule } from '../hotels/hotels.module';
import { ItinerariesModule } from '../itineraries';
import { FavouritesController } from './favourites.controller';
import { FavouritesService } from './favourites.service';
import { Favourite, FavouriteSchema } from './schemas/favourite.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Favourite.name, schema: FavouriteSchema }]),
    // Read only: the Hotel model (HotelsModule exports its MongooseModule) to check a hotel exists and is active.
    HotelsModule,
    // Read only: ItinerariesPublicService.loadPublic decides whether an itinerary is public.
    ItinerariesModule,
  ],
  controllers: [FavouritesController],
  providers: [FavouritesService],
})
export class FavouritesModule {}
