import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Hotel.name, schema: HotelSchema }]), ReferenceDataModule],
  controllers: [HotelsController],
  providers: [HotelsService],
  // Rooms, policies and search (other tickets) will inject HotelsService / the Hotel model from here.
  exports: [HotelsService, MongooseModule],
})
export class HotelsModule {}
