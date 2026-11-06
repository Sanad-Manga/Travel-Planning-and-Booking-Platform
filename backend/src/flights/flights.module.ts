import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { FlightCabinsReader } from './flight-cabins.reader';
import { FlightSearchController } from './flight-search.controller';
import { FlightSearchService } from './flight-search.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { Cabin, CabinSchema } from './schemas/cabin.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: Cabin.name, schema: CabinSchema },
    ]),
    AirlinesModule,
    ReferenceDataModule,
  ],
  // FlightSearchController is listed first so GET /flights/search can never be captured by a future GET /flights/:id.
  controllers: [FlightSearchController, FlightsController],
  providers: [FlightsService, FlightSearchService, FlightCabinsReader],
  exports: [FlightsService],
})
export class FlightsModule {}