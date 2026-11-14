import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { HotelAvailabilityService } from './hotel-availability.service';
import { HotelFreeRoomsController } from './hotel-free-rooms.controller';
import { HotelFreeRoomsService } from './hotel-free-rooms.service';
import { HotelSearchController } from './hotel-search.controller';
import { HotelSearchService } from './hotel-search.service';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { NoRoomReservations, RoomReservations } from './room-reservations';
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
  // HotelSearchController first: fixed routes (search) must be matched before any future :id route.
  controllers: [HotelSearchController, HotelFreeRoomsController, HotelsController, RoomsController],
  providers: [
    HotelsService,
    RoomsService,
    HotelAvailabilityService,
    HotelSearchService,
    HotelFreeRoomsService,
    // Stub until hotel bookings exist (HTL-16): Hotels B replaces useClass with the real reservation lookup.
    { provide: RoomReservations, useClass: NoRoomReservations },
  ],
  // Policies, availability and search (other tickets) will inject these / the Hotel and Room models from here.
  exports: [HotelsService, RoomsService, HotelAvailabilityService, RoomReservations, MongooseModule],
})
export class HotelsModule {}
