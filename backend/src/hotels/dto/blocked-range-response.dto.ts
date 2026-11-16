import { ApiProperty } from '@nestjs/swagger';

export class BlockedRangeResponseDto {
  @ApiProperty({ description: 'Id of the blocked range.', example: '6730a1f2c3d4e5f607182960' })
  id: string;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182940' })
  roomId: string;

  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  hotelId: string;

  @ApiProperty({ example: '2026-12-20' })
  startDate: string;

  @ApiProperty({ description: 'First day that is not blocked again; the block is [startDate, endDate).', example: '2026-12-23' })
  endDate: string;
}
