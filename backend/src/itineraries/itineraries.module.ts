import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { UsersModule } from '../users/users.module';
import { ItinerariesPublicController } from './itineraries-public.controller';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';
import {
  TransportCost,
  TransportCostSchema,
} from './schemas/transport-cost.schema';
import { TransportCostsController } from './transport-costs.controller';
import { TransportCostsService } from './transport-costs.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: TransportCost.name, schema: TransportCostSchema },
    ]),
    // Countries are validated through ReferenceDataService, never by reading the collection directly.
    ReferenceDataModule,
    // ITN-20: public search shows an itinerary only while its author's account is ACTIVE (ACC-12).
    UsersModule,
  ],
  // The public controller comes first so its static paths win over ItinerariesController's /:id.
  controllers: [
    ItinerariesPublicController,
    ItinerariesController,
    TransportCostsController,
  ],
  providers: [ItinerariesService, TransportCostsService],
  // Blog (author page) and Reports (hide/delete) look itineraries up through the service, never the model.
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
