import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Notification } from '../notifications/schemas/notification.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { User } from '../users/schemas/user.schema';
import { Country } from '../reference-data/schemas/country.schema';
import { City } from '../reference-data/schemas/city.schema';
import { Airport } from '../reference-data/schemas/airport.schema';
import { Attraction } from '../reference-data/schemas/attraction.schema';
import { Currency } from '../reference-data/schemas/currency.schema';
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
      .overrideProvider(getModelToken(User.name))
      .useValue({})
      .overrideProvider(getModelToken(Country.name))
      .useValue({})
      .overrideProvider(getModelToken(City.name))
      .useValue({})
      .overrideProvider(getModelToken(Airport.name))
      .useValue({})
      .overrideProvider(getModelToken(Attraction.name))
      .useValue({})
      .overrideProvider(getModelToken(Currency.name))
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
