import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications';
import { PaymentsModule } from '../payments';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { UsersModule } from '../users/users.module';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelAvailabilityService } from './hotel-availability.service';
import { HotelDetailsController } from './hotel-details.controller';
import { HotelDetailsService } from './hotel-details.service';
import { HotelFreeRoomsController } from './hotel-free-rooms.controller';
import { HotelFreeRoomsService } from './hotel-free-rooms.service';
import { HotelRoomStatusController } from './hotel-room-status.controller';
import { HotelRoomStatusService } from './hotel-room-status.service';
import { HotelReviewsController } from './hotel-reviews.controller';
import { HotelReviewsService } from './hotel-reviews.service';
import { HotelSearchController } from './hotel-search.controller';
import { HotelSearchService } from './hotel-search.service';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { RoomReservations } from './room-reservations';
import { HotelBooking, HotelBookingSchema } from './schemas/hotel-booking.schema';
import { HotelReview, HotelReviewSchema } from './schemas/hotel-review.schema';
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
      { name: HotelReview.name, schema: HotelReviewSchema },
    ]),
    ReferenceDataModule,
    PaymentsModule,
    NotificationsModule,
    UsersModule,
  ],
  // HotelSearchController first: the fixed route (search) must be matched before GET :id (HotelDetailsController).
  controllers: [
    HotelSearchController,
    HotelDetailsController,
    HotelFreeRoomsController,
    HotelRoomStatusController,
    HotelBookingsController,
    HotelReviewsController,
    HotelsController,
    RoomsController,
  ],
  providers: [
    HotelsService,
    HotelDetailsService,
    RoomsService,
    HotelAvailabilityService,
    HotelSearchService,
    HotelFreeRoomsService,
    HotelRoomStatusService,
    HotelBookingsService,
    HotelReviewsService,
    { provide: RoomReservations, useExisting: HotelBookingsService },
  ],
  // Policies, availability and search (other tickets) will inject these / the Hotel and Room models from here.
  exports: [HotelsService, RoomsService, HotelAvailabilityService, RoomReservations, MongooseModule],
})
export class HotelsModule {}
