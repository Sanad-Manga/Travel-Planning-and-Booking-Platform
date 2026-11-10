import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Room, RoomSchema } from './schemas/room.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
    ]),
    ReferenceDataModule,
  ],
  controllers: [HotelsController, RoomsController],
  providers: [HotelsService, RoomsService],
  // Policies, availability and search (other tickets) will inject these / the Hotel and Room models from here.
  exports: [HotelsService, RoomsService, MongooseModule],
})
export class HotelsModule {}
