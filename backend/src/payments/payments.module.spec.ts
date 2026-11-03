import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { BookingLifecycle } from './booking-lifecycle.service';
import { BookingProviderRegistry } from './booking-provider.registry';
import { PaymentsModule } from './payments.module';

describe('PaymentsModule wiring', () => {
  it('provides the lifecycle and registers the every-minute hold-expiry cron job', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PaymentsModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(app.get(BookingLifecycle)).toBeInstanceOf(BookingLifecycle);
      expect(app.get(BookingProviderRegistry)).toBeInstanceOf(
        BookingProviderRegistry,
      );

      const jobs = [...app.get(SchedulerRegistry).getCronJobs().values()];
      expect(jobs).toHaveLength(1);
      expect(jobs[0].cronTime.source).toBe(CronExpression.EVERY_MINUTE);
    } finally {
      await app.close();
    }
  });
});
