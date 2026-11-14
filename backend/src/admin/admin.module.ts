import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditModule } from '../audit/audit.module';
import { AdminPasswordResetController } from './admin-password-reset.controller';
import { AdminPasswordResetService } from './admin-password-reset.service';
import { PasswordResetTargetService } from './password-reset-target.service';
import { TemporaryPasswordService } from './temporary-password.service';

@Module({
  imports: [
    AuditModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AdminController, AdminPasswordResetController],
  providers: [AdminService, AdminPasswordResetService, PasswordResetTargetService, TemporaryPasswordService],
})
export class AdminModule {}
