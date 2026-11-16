import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common';
import { HotelBookingGroup } from '../hotel-booking-groups';

/** Query of `GET /api/hotel-bookings` (HTL-20): the usual `page` and `limit`, plus the group to show. */
export class MyHotelBookingsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: HotelBookingGroup,
    description:
      'Only this group. UPCOMING: confirmed stays that are not over, and reservations still waiting for payment. ' +
      'PAST: completed stays and confirmed stays whose check-out day is today or earlier. ' +
      'CANCELLED: cancelled reservations, expired ones and holds that ran out. Leave it out to list everything, newest first.',
  })
  @IsOptional()
  @IsEnum(HotelBookingGroup)
  group?: HotelBookingGroup;
}
