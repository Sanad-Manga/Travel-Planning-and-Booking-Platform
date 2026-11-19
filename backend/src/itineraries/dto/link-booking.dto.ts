import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingStatus, BookingType } from '../../common';
import { BudgetCategory } from '../schemas/budget.schema';
import { ItineraryBookingLean } from '../schemas/itinerary-booking.schema';
import {
  INTERCITY_TRANSPORT,
  SUMMARY_CATEGORIES,
  SummaryCategory,
} from './budget-summary.dto';

/**
 * Body of POST /api/itineraries/:id/bookings (ITN-27). The itinerary comes from the URL and the owner from the login.
 * The amount and the currency are read from the booking, never sent.
 */
export class LinkBookingDto {
  @ApiProperty({ enum: BookingType, example: BookingType.HOTEL })
  @IsEnum(BookingType, {
    message: `bookingType must be one of: ${Object.values(BookingType).join(', ')}`,
  })
  bookingType: BookingType;

  @ApiProperty({
    example: '6730a1f2c3d4e5f607182950',
    description: 'The id of one of my CONFIRMED flight or hotel bookings.',
  })
  @IsMongoId({ message: 'bookingId must be a valid id' })
  bookingId: string;

  @ApiProperty({
    example: '674a1b2c3d4e5f6a7b8c9d10',
    description: 'A day of this itinerary.',
  })
  @IsMongoId({ message: 'dayId must be a valid id' })
  dayId: string;
}

/** Which line of the budget summary a linked booking is counted under. */
export function summaryCategoryOf(type: BookingType): SummaryCategory {
  return type === BookingType.HOTEL
    ? BudgetCategory.ACCOMMODATION
    : INTERCITY_TRANSPORT;
}

export class ItineraryBookingDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d50' })
  id: string;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d0e' })
  itineraryId: string;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d10' })
  dayId: string;

  @ApiProperty({ enum: BookingType, example: BookingType.HOTEL })
  bookingType: BookingType;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  bookingId: string;

  @ApiProperty({
    enum: SUMMARY_CATEGORIES,
    example: 'ACCOMMODATION',
    description:
      'The budget line the amount is counted under: a hotel booking is ACCOMMODATION, a flight booking is INTERCITY_TRANSPORT.',
  })
  category: SummaryCategory;

  @ApiProperty({
    example: 30000,
    description:
      'The booking total in integer cents of `currency`, as it was when it was linked.',
  })
  amountCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}

/** Response DTO, never the raw document: `_id` becomes `id` and ids are strings. */
export function toItineraryBookingDto(
  doc: ItineraryBookingLean,
): ItineraryBookingDto {
  return {
    id: doc._id.toString(),
    itineraryId: doc.itineraryId.toString(),
    dayId: doc.dayId.toString(),
    bookingType: doc.bookingType,
    bookingId: doc.bookingId.toString(),
    category: summaryCategoryOf(doc.bookingType),
    amountCents: doc.amountCents,
    currency: doc.currency,
  };
}

/** One link in the list of an itinerary: the link, the booking's status now, and whether it counts in the budget. */
export class ItineraryBookingListItemDto extends ItineraryBookingDto {
  @ApiProperty({
    enum: BookingStatus,
    nullable: true,
    example: BookingStatus.CONFIRMED,
    description:
      'The status of the booking now, read from its owner. null if the booking cannot be read any more.',
  })
  bookingStatus: BookingStatus | null;

  @ApiProperty({
    example: true,
    description:
      'Whether the amount counts in the budget: only a CONFIRMED or COMPLETED booking does, so a cancelled one does not.',
  })
  counted: boolean;
}
