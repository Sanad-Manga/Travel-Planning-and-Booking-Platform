import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RoomBlockedReason, RoomDateStatus } from '../hotel-room-status.rules';

export class RoomReservationRefDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182950', description: 'Reservation id' })
  id: string;

  @ApiProperty({
    example: 'HTL-1A2B3C4D5E6F7A8B',
    nullable: true,
    type: String,
    description: 'The reservation reference shown to the guest. Null while the reservation is only held for payment (it is assigned when payment confirms it).',
  })
  reference: string | null;

  @ApiProperty({
    example: 'CONFIRMED',
    enum: ['CONFIRMED', 'PENDING_PAYMENT'],
    description: 'PENDING_PAYMENT = an unexpired hold waiting for payment (it blocks the room like a confirmed stay).',
  })
  status: string;

  @ApiProperty({ example: '2027-03-12', description: 'First night of the whole stay (it can start before the requested range).' })
  checkIn: string;

  @ApiProperty({ example: '2027-03-15', description: 'Check-out day of the whole stay (not a night).' })
  checkOut: string;
}

/** The ONE status of a room on ONE date. A date means the night that starts on it. */
export class RoomDayStatusDto {
  @ApiProperty({ example: '2027-03-10' })
  date: string;

  @ApiProperty({ enum: RoomDateStatus, example: RoomDateStatus.AVAILABLE })
  status: RoomDateStatus;

  @ApiPropertyOptional({ type: RoomReservationRefDto, description: 'Only when status is BOOKED.' })
  reservation?: RoomReservationRefDto;

  @ApiPropertyOptional({ enum: RoomBlockedReason, description: 'Only when status is BLOCKED.' })
  blockedReason?: RoomBlockedReason;
}

export class RoomStatusItemDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182940' })
  roomId: string;

  @ApiProperty({ example: '101' })
  name: string;

  @ApiProperty({ example: 'Double' })
  type: string;

  @ApiProperty({ example: true, description: 'false = the room is taken out of sale (HTL-06); its dates that are not booked then read BLOCKED.' })
  isActive: boolean;

  @ApiProperty({ type: [RoomDayStatusDto], description: 'One entry per date from `from` to `to`, ascending.' })
  days: RoomDayStatusDto[];
}

export class RoomStatusPageDto {
  @ApiProperty({ type: [RoomStatusItemDto], description: 'The rooms of the page, ordered by room name (numbers in natural order).' })
  items: RoomStatusItemDto[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 1, description: 'Number of rooms of the hotel.' })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
