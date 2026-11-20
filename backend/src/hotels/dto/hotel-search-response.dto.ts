import { ApiProperty } from '@nestjs/swagger';

/** One hotel of a search result (HTL-11). */
export class HotelSearchItemDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  id: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiProperty({ example: 'CAI' })
  cityId: string;

  @ApiProperty({ example: 'Cairo' })
  cityName: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiProperty({ example: 'Egypt' })
  countryName: string;

  @ApiProperty({ example: 4 })
  starRating: number;

  @ApiProperty({ example: 3, description: 'How many rooms of this hotel are free for the whole stay.' })
  freeRooms: number;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({
    example: 48000,
    description:
      'Cheapest total for the whole stay in integer cents: nights x the cheapest nightly sum of the requested number of free rooms that together fit the guests. A "from" price, not a booking.',
  })
  cheapestTotalCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}

export class HotelSearchPageDto {
  @ApiProperty({ type: [HotelSearchItemDto] })
  items: HotelSearchItemDto[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
