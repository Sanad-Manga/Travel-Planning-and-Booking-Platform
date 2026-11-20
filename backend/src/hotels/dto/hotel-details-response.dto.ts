import { ApiProperty } from '@nestjs/swagger';
import { HotelPhotoDto } from './create-hotel.dto';
import { FreeRoomsPageDto } from './free-rooms-response.dto';
import { HotelPoliciesResponseDto } from './hotel-policies-response.dto';

/** One visible guest review on the public hotel details page. */
export class HotelReviewItemDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  id: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating: number;

  @ApiProperty({ example: 'Clean rooms and a great view of the Nile.' })
  comment: string;

  @ApiProperty({ example: 'Sara A.', description: 'Display name of the reviewer.' })
  authorName: string;

  @ApiProperty({ example: '2026-11-20T14:30:00.000Z' })
  createdAt: string;

  @ApiProperty({
    required: false,
    example: 'Thank you for staying with us!',
    description: 'The hotel moderator\'s reply, if any (HTL-26).',
  })
  reply?: string;

  @ApiProperty({ required: false, example: '2026-11-21T09:00:00.000Z' })
  repliedAt?: string;
}

/** Public hotel details page (HTL-02). Only an ACTIVE hotel is returned. */
export class HotelDetailsResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil' })
  address: string;

  @ApiProperty({ example: 'CAI' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ type: [HotelPhotoDto], description: 'At most 5 photos.' })
  photos: HotelPhotoDto[];

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  starRating: number;

  @ApiProperty({ type: [String], example: ['wifi', 'pool'] })
  amenities: string[];

  @ApiProperty({
    type: HotelPoliciesResponseDto,
    description:
      'Standard check-in and check-out time (HH:mm, hotel local time, null = not set) and the cancellation tiers (largest threshold first, [] = nothing is refunded). Same data the booking policies (PAY-02) show.',
  })
  policies: HotelPoliciesResponseDto;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4.5,
    description: 'Average of visible guest ratings. null = no rating yet.',
  })
  averageRating: number | null;

  @ApiProperty({ example: 0, description: 'Number of visible guest reviews.' })
  reviewCount: number;

  @ApiProperty({ type: [HotelReviewItemDto], description: 'Visible reviews, newest first.' })
  reviews: HotelReviewItemDto[];

  @ApiProperty({
    type: FreeRoomsPageDto,
    nullable: true,
    description:
      'The rooms free for every night of the stay (same list and order as GET /api/hotels/:id/rooms/available, paged by page/limit). null when no checkIn/checkOut was sent: rooms are only returned for dates. An empty items list means no room is free.',
  })
  rooms: FreeRoomsPageDto | null;
}
