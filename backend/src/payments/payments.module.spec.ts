import { getModelToken } from '@nestjs/mongoose';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { BookingLifecycle } from './booking-lifecycle.service';
import { BookingProviderRegistry } from './booking-provider.registry';
import { PAYMENT_ACTIVITY } from './payment-activity';
import { PaymentsModule } from './payments.module';
import { Payment } from './schemas/payment.schema';
import { PolicyAcceptance } from './schemas/policy-acceptance.schema';
import { StripePaymentActivity } from './stripe-payment-activity';

describe('PaymentsModule wiring', () => {
  it('provides the lifecycle, real Stripe payment activity, and registers the every-minute hold-expiry cron job', async () => {
    // No real Mongo connection here on purpose (pure DI-wiring check): stub out the
    // model tokens instead of pulling MongooseModule.forRoot into this test. StripePaymentGateway
    // itself never touches process.env at construction time (only when actually called), so it
    // needs no STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET here.
    const moduleRef = await Test.createTestingModule({
      imports: [PaymentsModule],
    })
      .overrideProvider(getModelToken(PolicyAcceptance.name))
      .useValue({})
      .overrideProvider(getModelToken(Payment.name))
      .useValue({})
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(app.get(BookingLifecycle)).toBeInstanceOf(BookingLifecycle);
      expect(app.get(BookingProviderRegistry)).toBeInstanceOf(
        BookingProviderRegistry,
      );
      expect(app.get(PAYMENT_ACTIVITY)).toBeInstanceOf(StripePaymentActivity);

      const jobs = [...app.get(SchedulerRegistry).getCronJobs().values()];
      expect(jobs).toHaveLength(1);
      expect(jobs[0].cronTime.source).toBe(CronExpression.EVERY_MINUTE);
    } finally {
      await app.close();
    }
  });
});
