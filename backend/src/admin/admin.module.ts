import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AccountStatusController } from './account-status.controller';
import { AccountStatusService } from './account-status.service';
import {
  AccountStatusOperation,
  AccountStatusOperationSchema,
} from './schemas/account-status-operation.schema';

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
  controllers: [AdminController, AccountStatusController],
  providers: [AdminService, AccountStatusService],
})
export class AdminModule {}
