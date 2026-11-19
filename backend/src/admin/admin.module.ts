import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { AuditModule } from '../audit/audit.module';
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
import { AirlinesModule } from '../airlines/airlines.module';
import { HotelsModule } from '../hotels/hotels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import { AdminPasswordResetController } from './admin-password-reset.controller';
import { AdminPasswordResetService } from './admin-password-reset.service';
import { ProviderStatusController } from './provider-status.controller';
import { ProviderStatusService } from './provider-status.service';
import { ModeratorAccountsController } from './moderator-accounts.controller';
import { ModeratorAccountsService } from './moderator-accounts.service';
import { PasswordResetTargetService } from './password-reset-target.service';
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
      { name: Airline.name, schema: AirlineSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Flight.name, schema: FlightSchema },
      {
        name: AccountStatusOperation.name,
        schema: AccountStatusOperationSchema,
      },
    ]),
    AuditModule,
    NotificationsModule,
    AirlinesModule,
    HotelsModule,
  ],
  controllers: [
    AdminController,
    AdminBookingsController,
    AccountStatusController,
    AdminPasswordResetController,
    ProviderStatusController,
    ModeratorAccountsController,
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
  ],
})
export class AdminModule {}
