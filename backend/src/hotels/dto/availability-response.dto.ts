import { ApiProperty } from '@nestjs/swagger';

export class AvailabilityResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182950' })
  id: string;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182940' })
  roomId: string;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  hotelId: string;

  @ApiProperty({ example: '2026-12-01' })
  startDate: string;

  @ApiProperty({ description: 'Check-out day; the range is [startDate, endDate).', example: '2026-12-15' })
  endDate: string;
}
