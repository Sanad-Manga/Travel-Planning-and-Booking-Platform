import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    // Countries are validated through ReferenceDataService, never by reading the collection directly.
    ReferenceDataModule,
  ],
  controllers: [ItinerariesController],
  providers: [ItinerariesService],
  // Blog (author page) and Reports (hide/delete) look itineraries up through the service, never the model.
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
