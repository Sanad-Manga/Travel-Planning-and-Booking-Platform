import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { AuditModule } from '../audit/audit.module';
import { BlogModule } from '../blog/blog.module';
import { EmailModule } from '../email';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flights/schemas/flight-booking.schema';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotels/schemas/hotel-booking.schema';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { HotelReview, HotelReviewSchema } from '../hotels/schemas/hotel-review.schema';
import { AirlinesModule } from '../airlines/airlines.module';
import { HotelsModule } from '../hotels/hotels.module';
import { Itinerary, ItinerarySchema } from '../itineraries/schemas/itinerary.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import { AdminContentController } from './admin-content.controller';
import { AdminContentService } from './admin-content.service';
import { AdminPasswordResetController } from './admin-password-reset.controller';
import { AdminPasswordResetService } from './admin-password-reset.service';
import { ProviderStatusController } from './provider-status.controller';
import { ProviderStatusService } from './provider-status.service';
import { ModeratorAccountsController } from './moderator-accounts.controller';
import { ModeratorAccountsService } from './moderator-accounts.service';
import { PasswordResetTargetService } from './password-reset-target.service';
import { ReportsAdminController } from './reports-admin.controller';
import { ReportsAdminService } from './reports-admin.service';
import {
  AccountStatusOperation,
  AccountStatusOperationSchema,
} from './schemas/account-status-operation.schema';
import { TemporaryPasswordService } from './temporary-password.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Hotel.name, schema: HotelSchema },
      { name: HotelReview.name, schema: HotelReviewSchema },
      { name: Airline.name, schema: AirlineSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Flight.name, schema: FlightSchema },
      {
        name: AccountStatusOperation.name,
        schema: AccountStatusOperationSchema,
      },
      // GEN-10: Itinerary and HotelReview reused directly (ItinerariesModule/HotelsModule export
      // only their services, not the models directly) — same pattern as ReportsModule's own
      // read-only Post/Itinerary registrations.
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    AuditModule,
    NotificationsModule,
    EmailModule,
    AirlinesModule,
    HotelsModule,
    // GEN-10: ReportsService + the Report model (and Post/Itinerary again, harmlessly, via its
    // re-exported MongooseModule). BlogModule: BlogService (deletePostAndDependents) + the
    // Post/Comment models.
    ReportsModule,
    BlogModule,
  ],
  controllers: [
    AdminController,
    AdminBookingsController,
    AccountStatusController,
    AdminPasswordResetController,
    ProviderStatusController,
    ModeratorAccountsController,
    ReportsAdminController,
    AdminContentController,
  ],
  providers: [
    AdminService,
    AdminBookingsService,
    AccountStatusService,
    AdminPasswordResetService,
    ProviderStatusService,
    PasswordResetTargetService,
    TemporaryPasswordService,
    ModeratorAccountsService,
    ReportsAdminService,
    AdminContentService,
  ],
})
export class AdminModule {}
