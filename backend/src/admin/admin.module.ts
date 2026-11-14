import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import { AdminPasswordResetController } from './admin-password-reset.controller';
import { AdminPasswordResetService } from './admin-password-reset.service';
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
  ],
  providers: [
    AdminService,
    AccountStatusService,
    AdminPasswordResetService,
    PasswordResetTargetService,
    TemporaryPasswordService,
  ],
})
export class AdminModule {}
