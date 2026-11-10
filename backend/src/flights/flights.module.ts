import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { NotificationsModule } from '../notifications';
import { PaymentsModule } from '../payments';
import { FlightBookingProvider } from './flight-booking.provider';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { FlightCabinsReader } from './flight-cabins.reader';
import { FlightInventoryService } from './flight-inventory.service';
import { FlightSearchController } from './flight-search.controller';
import { FlightSearchService } from './flight-search.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { Cabin, CabinSchema } from './schemas/cabin.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: Cabin.name, schema: CabinSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
    AirlinesModule,
    ReferenceDataModule,
    PaymentsModule, // BookingLifecycle + BookingProviderRegistry (FLT-22 registers the flight booking provider)
    NotificationsModule,
  ],
  // FlightSearchController is listed first so GET /flights/search can never be captured by a future GET /flights/:id.
  controllers: [
    FlightSearchController,
    FlightsController,
    FlightBookingsController,
  ],
  providers: [
    FlightsService,
    FlightSearchService,
    FlightCabinsReader,
    FlightInventoryService,
    FlightBookingsService,
    FlightBookingProvider,
  ],
  exports: [FlightsService],
})
export class FlightsModule {}