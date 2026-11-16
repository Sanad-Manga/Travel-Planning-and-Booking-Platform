import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { BookingLifecycle } from './booking-lifecycle.service';
import { BookingPoliciesController } from './booking-policies.controller';
import { BookingProviderRegistry } from './booking-provider.registry';
import { PAYMENT_ACTIVITY, StubPaymentActivity } from './payment-activity';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from './schemas/policy-acceptance.schema';

// ScheduleModule.forRoot() is what makes the @Cron sweep run. Nest registers an identical dynamic module only once,
// so it is harmless if AppModule or another module also imports it.
//
// PAYMENT_ACTIVITY is bound to StubPaymentActivity (always EXPIRE) until PAY-01 exists.
// Swap the provider here for the real Stripe-aware implementation once that ticket lands —
// nothing outside this module needs to change.
@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
    ]),
  ],
  controllers: [BookingPoliciesController],
  providers: [
    BookingProviderRegistry,
    BookingLifecycle,
    PolicyAcceptanceService,
    { provide: PAYMENT_ACTIVITY, useClass: StubPaymentActivity },
  ],
  exports: [BookingProviderRegistry, BookingLifecycle, PolicyAcceptanceService],
})
export class PaymentsModule {}
