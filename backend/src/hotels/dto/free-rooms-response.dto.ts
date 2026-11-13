import { ApiProperty } from '@nestjs/swagger';

/** One room that is free for every night of the searched stay (HTL-15). `roomId` is what the booking (HTL-16) receives. */
export class FreeRoomItemDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182940', description: 'The room id: the client sends the chosen roomIds to the booking (HTL-16).' })
  roomId: string;

  @ApiProperty({ example: '101' })
  name: string;

  @ApiProperty({ example: 'Double' })
  type: string;

  @ApiProperty({ example: 2 })
  beds: number;

  @ApiProperty({ example: 3 })
  maxOccupancy: number;

  @ApiProperty({ example: 8500, description: 'Integer cents of the platform currency.' })
  pricePerNightCents: number;

  @ApiProperty({ example: 25500, description: 'Whole stay in integer cents: nights x pricePerNightCents.' })
  totalCents: number;

  @ApiProperty({ example: '2027-03-10' })
  checkIn: string;

  @ApiProperty({ example: '2027-03-13' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}

export class FreeRoomsPageDto {
  @ApiProperty({ type: [FreeRoomItemDto] })
  items: FreeRoomItemDto[];

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
