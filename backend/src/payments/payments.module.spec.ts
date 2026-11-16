import { getModelToken } from '@nestjs/mongoose';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { BookingLifecycle } from './booking-lifecycle.service';
import { BookingProviderRegistry } from './booking-provider.registry';
import { PAYMENT_ACTIVITY, StubPaymentActivity } from './payment-activity';
import { PaymentsModule } from './payments.module';
import { PolicyAcceptance } from './schemas/policy-acceptance.schema';

describe('PaymentsModule wiring', () => {
  it('provides the lifecycle, payment activity stub, and registers the every-minute hold-expiry cron job', async () => {
    // No real Mongo connection here on purpose (pure DI-wiring check): stub out the
    // PAY-02 model token instead of pulling MongooseModule.forRoot into this test.
    const moduleRef = await Test.createTestingModule({
      imports: [PaymentsModule],
    })
      .overrideProvider(getModelToken(PolicyAcceptance.name))
      .useValue({})
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(app.get(BookingLifecycle)).toBeInstanceOf(BookingLifecycle);
      expect(app.get(BookingProviderRegistry)).toBeInstanceOf(
        BookingProviderRegistry,
      );
      expect(app.get(PAYMENT_ACTIVITY)).toBeInstanceOf(StubPaymentActivity);

      const jobs = [...app.get(SchedulerRegistry).getCronJobs().values()];
      expect(jobs).toHaveLength(1);
      expect(jobs[0].cronTime.source).toBe(CronExpression.EVERY_MINUTE);
    } finally {
      await app.close();
    }
  });
});
