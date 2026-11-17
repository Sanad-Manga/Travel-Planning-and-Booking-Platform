import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { BookingLifecycle } from './booking-lifecycle.service';
import { BookingPoliciesController } from './booking-policies.controller';
import { BookingProviderRegistry } from './booking-provider.registry';
import { PAYMENT_ACTIVITY } from './payment-activity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from './schemas/policy-acceptance.schema';
import { STRIPE_GATEWAY, StripePaymentGateway } from './stripe-gateway';
import { StripePaymentActivity } from './stripe-payment-activity';

// ScheduleModule.forRoot() is what makes the @Cron sweep run. Nest registers an identical dynamic module only once,
// so it is harmless if AppModule or another module also imports it.
@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  controllers: [BookingPoliciesController, PaymentsController],
  providers: [
    BookingProviderRegistry,
    BookingLifecycle,
    PolicyAcceptanceService,
    PaymentsService,
    { provide: STRIPE_GATEWAY, useClass: StripePaymentGateway },
    { provide: PAYMENT_ACTIVITY, useClass: StripePaymentActivity },
  ],
  exports: [BookingProviderRegistry, BookingLifecycle, PolicyAcceptanceService],
})
export class PaymentsModule {}
