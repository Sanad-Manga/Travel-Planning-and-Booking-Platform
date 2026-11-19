import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines';
import { FlightCabinsReader } from '../flights/flight-cabins.reader';
import { FlightSearchService } from '../flights/flight-search.service';
import { Cabin, CabinSchema } from '../flights/schemas/cabin.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import { FxModule } from '../fx';
import { HotelSearchService } from '../hotels/hotel-search.service';
import { HotelsModule } from '../hotels/hotels.module';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { UploadsModule } from '../uploads';
import { UsersModule } from '../users/users.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { ItinerariesPublicController } from './itineraries-public.controller';
import { ItinerariesPublicService } from './itineraries-public.service';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { ItineraryCloneController } from './itinerary-clone.controller';
import { ItineraryCloneService } from './itinerary-clone.service';
import { ItineraryFlightsController } from './itinerary-flights.controller';
import { ItineraryFlightsService } from './itinerary-flights.service';
import { ItineraryHotelsController } from './itinerary-hotels.controller';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import { ItineraryItemsController } from './itinerary-items.controller';
import { ItineraryPdfController } from './itinerary-pdf.controller';
import { ItineraryPdfService } from './itinerary-pdf.service';
import { ItineraryPublicPdfController } from './itinerary-public-pdf.controller';
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
      // ITN-26: the flight search (FLT-11) reads these two collections; see the providers below.
      { name: Flight.name, schema: FlightSchema },
      { name: Cabin.name, schema: CabinSchema },
    ]),
    // Countries are validated through ReferenceDataService, never by reading the collection directly.
    ReferenceDataModule,
    // ITN-20: public search shows an itinerary only while its author's account is ACTIVE (ACC-12).
    UsersModule,
    // ITN-12: activity images are stored through the shared UploadService (GEN-08).
    UploadsModule,
    // ITN-25: the hotel search (HTL-11) needs the hotel models and HotelAvailabilityService, which HotelsModule exports.
    HotelsModule,
    // ITN-18: the budget summary's grand total is converted into the caller's preferred currency.
    FxModule,
    // ITN-26: the flight search looks airlines up through AirlinesService.
    AirlinesModule,
  ],
  // The public controller comes first so its static paths win over ItinerariesController's /:id.
  controllers: [
    ItinerariesPublicController,
    ItineraryPublicPdfController,
    ItinerariesController,
    ItineraryPdfController,
    ItineraryItemsController,
    ItineraryHotelsController,
    ItineraryFlightsController,
    ItineraryCloneController,
    ActivitiesController,
    TransportCostsController,
    BudgetsController,
  ],
  providers: [
    ItinerariesService,
    ItinerariesPublicService,
    ItineraryCloneService,
    ItineraryHotelsService,
    ItineraryFlightsService,
    ItineraryPdfService,
    ActivitiesService,
    TransportCostsService,
    BudgetsService,
    // ITN-25: HotelsModule does not export HotelSearchService, and its module is not mine to change. This provides
    // the SAME class (not a copy of its logic) here; it is stateless and takes only what is imported above. If the
    // hotels owner adds it to the exports of HotelsModule, delete this line.
    HotelSearchService,
    // ITN-26: the same situation for the flight search: FlightsModule exports only FlightsService, and its module is
    // not mine to change. This provides the SAME classes (not a copy of their logic) here, with the models and the
    // airline lookup imported above. If the flights owner adds FlightSearchService to the exports of FlightsModule,
    // delete these two lines, the Flight and Cabin entries of forFeature and the AirlinesModule import.
    FlightSearchService,
    FlightCabinsReader,
  ],
  // Blog (author page) and Reports (hide/delete) look itineraries up through the service, never the model.
  exports: [ItinerariesService, ItinerariesPublicService],
})
export class ItinerariesModule {}
