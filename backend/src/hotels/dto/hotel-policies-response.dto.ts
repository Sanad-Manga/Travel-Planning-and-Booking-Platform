import { ApiProperty } from '@nestjs/swagger';
import { CancellationTierDto } from './update-hotel-policies.dto';

export class HotelPoliciesResponseDto {
  @ApiProperty({ example: '6730a1f2c3d4e5f607182930' })
  hotelId: string;

  @ApiProperty({ type: [CancellationTierDto], description: 'Sorted from the largest threshold to the smallest.' })
  cancellationTiers: CancellationTierDto[];
}
