import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BookingLifecycle } from './booking-lifecycle.service';
import { BookingProviderRegistry } from './booking-provider.registry';
import { PAYMENT_ACTIVITY, StubPaymentActivity } from './payment-activity';

// ScheduleModule.forRoot() is what makes the @Cron sweep run. Nest registers an identical dynamic module only once,
// so it is harmless if AppModule or another module also imports it.
//
// PAYMENT_ACTIVITY is bound to StubPaymentActivity (always EXPIRE) until PAY-01 exists.
// Swap the provider here for the real Stripe-aware implementation once that ticket lands —
// nothing outside this module needs to change.
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    BookingProviderRegistry,
    BookingLifecycle,
    { provide: PAYMENT_ACTIVITY, useClass: StubPaymentActivity },
  ],
  exports: [BookingProviderRegistry, BookingLifecycle],
})
export class PaymentsModule {}
