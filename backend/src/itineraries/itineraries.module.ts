import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { UploadsModule } from '../uploads';
import { UsersModule } from '../users/users.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { ItinerariesPublicController } from './itineraries-public.controller';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { Activity, ActivitySchema } from './schemas/activity.schema';
import { Budget, BudgetSchema } from './schemas/budget.schema';
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
      { name: Activity.name, schema: ActivitySchema },
      { name: TransportCost.name, schema: TransportCostSchema },
      { name: Budget.name, schema: BudgetSchema },
    ]),
    // Countries are validated through ReferenceDataService, never by reading the collection directly.
    ReferenceDataModule,
    // ITN-20: public search shows an itinerary only while its author's account is ACTIVE (ACC-12).
    UsersModule,
    // ITN-12: activity images are stored through the shared UploadService (GEN-08).
    UploadsModule,
  ],
  // The public controller comes first so its static paths win over ItinerariesController's /:id.
  controllers: [
    ItinerariesPublicController,
    ItinerariesController,
    ActivitiesController,
    TransportCostsController,
    BudgetsController,
  ],
  providers: [
    ItinerariesService,
    ActivitiesService,
    TransportCostsService,
    BudgetsService,
  ],
  // Blog (author page) and Reports (hide/delete) look itineraries up through the service, never the model.
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
