import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { AuditModule } from '../audit/audit.module';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import { AdminPasswordResetController } from './admin-password-reset.controller';
import { AdminPasswordResetService } from './admin-password-reset.service';
import { ProviderStatusController } from './provider-status.controller';
import { ProviderStatusService } from './provider-status.service';
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
      {
        name: AccountStatusOperation.name,
        schema: AccountStatusOperationSchema,
      },
    ]),
    AuditModule,
    NotificationsModule,
  ],
  controllers: [
    AdminController,
    AccountStatusController,
    AdminPasswordResetController,
    ProviderStatusController,
  ],
  providers: [
    AdminService,
    AccountStatusService,
    AdminPasswordResetService,
    ProviderStatusService,
    PasswordResetTargetService,
    TemporaryPasswordService,
  ],
})
export class AdminModule {}
