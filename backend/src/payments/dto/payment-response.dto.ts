import { ApiProperty } from '@nestjs/swagger';
import { BookingType, PaymentStatus } from '../../common';

/**
 * Response for create/retry/GET (PAY-01). `clientSecret` is only present right after create or
 * retry, when the frontend/Swagger needs it to confirm the PaymentIntent with Stripe.js — never
 * on a later GET, since it's only useful once and Stripe doesn't guarantee it stays valid.
 */
export class PaymentResponseDto {
  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d03' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  bookingType: BookingType;

  @ApiProperty({ example: '674a1b2c3d4e5f6a7b8c9d01' })
  bookingId: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.REQUIRES_PAYMENT })
  status: PaymentStatus;

  @ApiProperty({ example: 25000, description: 'Integer minor units (cents).' })
  amountCents: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    required: false,
    example: 'pi_3Q.._secret_abc',
    description: 'Only on create/retry — pass to Stripe.js to confirm the PaymentIntent.',
  })
  clientSecret?: string;
}
