import { ApiProperty } from '@nestjs/swagger';
import { BookingType } from '../../common';

/** POST /api/bookings/:type/:id/accept-policies response (PAY-02). */
export class PolicyAcceptanceResponseDto {
  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  bookingType: BookingType;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' })
  bookingId: string;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d02' })
  userId: string;

  @ApiProperty({
    example: '2026-11-15T10:30:00.000Z',
    description: 'When the booking owner accepted the policies.',
  })
  acceptedAt: Date;
}
