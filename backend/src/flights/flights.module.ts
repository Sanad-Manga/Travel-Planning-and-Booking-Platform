import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { NotificationsModule } from '../notifications';
import { PaymentsModule } from '../payments';
import { RefundsModule } from '../refunds';
import { FlightBookingProvider } from './flight-booking.provider';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { FlightETicketService } from './flight-eticket.service';
import { FlightCabinsReader } from './flight-cabins.reader';
import { FlightInventoryService } from './flight-inventory.service';
import { FlightCabinsController } from './flight-cabins.controller';
import { FlightCabinsService } from './flight-cabins.service';
import { FlightSearchController } from './flight-search.controller';
import { FlightSearchService } from './flight-search.service';
import { FlightCancellationService } from './flight-cancellation.service';
import { FlightEditService } from './flight-edit.service';
import { FlightRosterService } from './flight-roster.service';
import { FlightSeatSelectionService } from './flight-seat-selection.service';
import { FlightStatusJob } from './flight-status.job';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { Cabin, CabinSchema } from './schemas/cabin.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';
import {
  FlightSeatClaim,
  FlightSeatClaimSchema,
} from './schemas/flight-seat-claim.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: Cabin.name, schema: CabinSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: FlightSeatClaim.name, schema: FlightSeatClaimSchema },
    ]),
    AirlinesModule,
    ReferenceDataModule,
    PaymentsModule, // BookingLifecycle + BookingProviderRegistry (FLT-22 registers the flight booking provider)
    RefundsModule, // PAY-03's getLatestForBooking, shown on the confirmed booking readback
    NotificationsModule,
    UsersModule, // ACC-12: UpcomingBookingsRegistry, where the flight bookings register their checker
  ],
  // FlightSearchController is listed first so GET /flights/search can never be captured by a future GET /flights/:id.
  controllers: [
    FlightSearchController,
    FlightsController,
    FlightBookingsController,
    FlightCabinsController,
  ],
  providers: [
    FlightsService,
    FlightSearchService,
    FlightCabinsReader,
    FlightInventoryService,
    FlightBookingsService,
    FlightSeatSelectionService,
    FlightBookingProvider,
    FlightETicketService,
    FlightCabinsService,
    FlightStatusJob,
    FlightEditService,
    FlightRosterService,
    FlightCancellationService,
  ],
  exports: [FlightsService],
})
export class FlightsModule {}
