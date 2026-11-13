import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { User, UserSchema } from './schemas/user.schema';
import { AccountDeactivationService } from './account-deactivation.service';
import { ProfileService } from './profile.service';
import { UpcomingBookingsRegistry } from './upcoming-bookings';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // ReferenceDataService (exported) validates the preferred currency; reference-data does not import users, so no cycle.
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), ReferenceDataModule],
  controllers: [UsersController],
  providers: [UsersService, ProfileService, AccountDeactivationService, UpcomingBookingsRegistry],
  // The registry is exported so Flights B / Hotels B can register their UpcomingBookingsChecker (ACC-12).
  exports: [UsersService, UpcomingBookingsRegistry],
})
export class UsersModule {}
