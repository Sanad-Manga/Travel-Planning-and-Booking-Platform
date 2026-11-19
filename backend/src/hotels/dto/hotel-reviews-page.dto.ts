import { ApiProperty } from '@nestjs/swagger';
import { PaginatedResponse } from '../../common';
import { HotelReviewItemDto } from './hotel-details-response.dto';

/** Standard pagination envelope for visible hotel reviews. */
export class HotelReviewsPageDto implements PaginatedResponse<HotelReviewItemDto> {
  @ApiProperty({ type: [HotelReviewItemDto] })
  items: HotelReviewItemDto[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 2 })
  totalPages: number;
}

/** Public rating summary and a page of visible hotel reviews (HTL-24). */
export class HotelReviewsResponseDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4.5,
    description:
      'Average rating across visible reviews; null when there are none.',
  })
  averageRating: number | null;

  @ApiProperty({
    example: 12,
    description: 'Number of visible reviews and ratings.',
  })
  reviewCount: number;

  @ApiProperty({ type: HotelReviewsPageDto })
  reviews: HotelReviewsPageDto;
}
