import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications';
import { PaymentsModule } from '../payments';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { UsersModule } from '../users/users.module';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelAvailabilityService } from './hotel-availability.service';
import { HotelFreeRoomsController } from './hotel-free-rooms.controller';
import { HotelFreeRoomsService } from './hotel-free-rooms.service';
import { HotelSearchController } from './hotel-search.controller';
import { HotelSearchService } from './hotel-search.service';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { RoomReservations } from './room-reservations';
import { HotelBooking, HotelBookingSchema } from './schemas/hotel-booking.schema';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Room, RoomSchema } from './schemas/room.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
    ReferenceDataModule,
    PaymentsModule,
    NotificationsModule,
    UsersModule,
  ],
  // HotelSearchController first: fixed routes (search) must be matched before any future :id route.
  controllers: [HotelSearchController, HotelFreeRoomsController, HotelBookingsController, HotelsController, RoomsController],
  providers: [
    HotelsService,
    RoomsService,
    HotelAvailabilityService,
    HotelSearchService,
    HotelFreeRoomsService,
    HotelBookingsService,
    { provide: RoomReservations, useExisting: HotelBookingsService },
  ],
  // Policies, availability and search (other tickets) will inject these / the Hotel and Room models from here.
  exports: [HotelsService, RoomsService, HotelAvailabilityService, RoomReservations, MongooseModule],
})
export class HotelsModule {}
