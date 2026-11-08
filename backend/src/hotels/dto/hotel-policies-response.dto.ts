import { ApiProperty } from '@nestjs/swagger';
import { CancellationTierDto } from './update-hotel-policies.dto';

export class HotelPoliciesResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  hotelId: string;

  @ApiProperty({ type: String, nullable: true, example: '14:00', description: 'Standard check-in time (24-hour HH:mm, hotel local time). null = not set yet.' })
  checkInTime: string | null;

  @ApiProperty({ type: String, nullable: true, example: '11:00', description: 'Standard check-out time (24-hour HH:mm, hotel local time). null = not set yet.' })
  checkOutTime: string | null;

  @ApiProperty({ type: [CancellationTierDto], description: 'Sorted from the largest threshold to the smallest. [] = nothing is refunded.' })
  cancellationTiers: CancellationTierDto[];
}
