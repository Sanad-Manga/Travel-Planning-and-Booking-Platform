import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BookingLifecycle } from './booking-lifecycle.service';
import { BookingProviderRegistry } from './booking-provider.registry';

// ScheduleModule.forRoot() is what makes the @Cron sweep run. Nest registers an identical dynamic module only once,
// so it is harmless if AppModule or another module also imports it.
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [BookingProviderRegistry, BookingLifecycle],
  exports: [BookingProviderRegistry, BookingLifecycle],
})
export class PaymentsModule {}
