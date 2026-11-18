import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { STRIPE_GATEWAY, StripePaymentGateway } from '../payments/stripe-gateway';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { Refund, RefundSchema } from './schemas/refund.schema';

/**
 * A sibling to `payments`/`fx` (docs/contracts.md's module list), not folded into `payments`,
 * even though both share the same owner. Registers its own `Payment` model binding (the schema
 * class is reused from `payments/schemas/payment.schema`, read-only here) instead of importing
 * `PaymentsModule` directly, so `PaymentsModule` can import `RefundsModule` one-way without a cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Refund.name, schema: RefundSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [RefundsController],
  providers: [RefundsService, { provide: STRIPE_GATEWAY, useClass: StripePaymentGateway }],
  exports: [RefundsService],
})
export class RefundsModule {}
