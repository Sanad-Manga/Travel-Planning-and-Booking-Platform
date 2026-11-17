import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../../common';

/** POST /api/payments body (PAY-01): which booking to charge. */
export class CreatePaymentDto {
  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  @IsEnum(BookingType)
  bookingType: BookingType;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' })
  @IsMongoId()
  bookingId: string;
}
