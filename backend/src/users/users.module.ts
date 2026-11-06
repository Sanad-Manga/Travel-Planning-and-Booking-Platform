import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { User, UserSchema } from './schemas/user.schema';
import { ProfileService } from './profile.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // ReferenceDataService (exported) validates the preferred currency; reference-data does not import users, so no cycle.
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), ReferenceDataModule],
  controllers: [UsersController],
  providers: [UsersService, ProfileService],
  exports: [UsersService],
})
export class UsersModule {}
