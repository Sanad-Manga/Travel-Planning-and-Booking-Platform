import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Notification } from '../notifications/schemas/notification.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { RefundsModule } from './refunds.module';
import { RefundsService } from './refunds.service';
import { Refund } from './schemas/refund.schema';

describe('RefundsModule wiring', () => {
  it('provides RefundsService (pure DI-wiring check, no real Mongo connection)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RefundsModule],
    })
      .overrideProvider(getModelToken(Refund.name))
      .useValue({})
      .overrideProvider(getModelToken(Payment.name))
      .useValue({})
      .overrideProvider(getModelToken(Notification.name))
      .useValue({})
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    try {
      expect(app.get(RefundsService)).toBeInstanceOf(RefundsService);
    } finally {
      await app.close();
    }
  });
});
