import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { BookingType, PaymentStatus } from '../src/common';
import configuration from '../src/config/configuration';
import { Payment } from '../src/payments/schemas/payment.schema';
import { STRIPE_GATEWAY } from '../src/payments/stripe-gateway';
import { FakeStripeGateway } from '../src/payments/fake-stripe-gateway';
import { RefundsModule, RefundsService } from '../src/refunds';
import { Refund } from '../src/refunds/schemas/refund.schema';

/**
 * PAY-03 review (PR #108): "check-then-call-Stripe-then-save is not atomic and createRefund has
 * no idempotency key. Two concurrent calls both pass the exists check and both create a Stripe
 * refund." A unit test with fakes cannot prove a real race is actually prevented (the same reason
 * payments-concurrency.e2e-spec.ts exists for PAY-01) — this fires two genuinely concurrent
 * RefundsService.issue() calls for the same payment against a real (in-memory) MongoDB and checks
 * both the database and the (idempotency-key-aware) fake Stripe gateway afterwards.
 */
describe('RefundsService.issue concurrency (PAY-03)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;
  let service: RefundsService;
  let stripe: FakeStripeGateway;

  const USER_ID = new Types.ObjectId();
  const BOOKING_ID = new Types.ObjectId();
  const STRIPE_PAYMENT_INTENT_ID = 'pi_concurrency_test';

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    stripe = new FakeStripeGateway();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        RefundsModule,
      ],
    })
      .overrideProvider(STRIPE_GATEWAY)
      .useValue(stripe)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get<Connection>(getConnectionToken());
    service = app.get(RefundsService);

    // Mongoose builds schema.index(...) indexes in the BACKGROUND, asynchronously — without this,
    // the race below could run before the unique indexes actually exist and both inserts would
    // wrongly succeed (the exact gotcha documented in payments-concurrency.e2e-spec.ts).
    await app.get(getModelToken(Payment.name)).init();
    await app.get(getModelToken(Refund.name)).init();

    // Seed a SUCCEEDED payment directly — issue() requires one to exist for the booking.
    await db.collection('payments').insertOne({
      bookingType: BookingType.FLIGHT,
      bookingId: BOOKING_ID,
      userId: USER_ID,
      stripePaymentIntentId: STRIPE_PAYMENT_INTENT_ID,
      amountCents: 15_000,
      currency: 'USD',
      status: PaymentStatus.SUCCEEDED,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('lets exactly one of two simultaneous refund issuances for the same payment succeed, and never refunds twice at Stripe', async () => {
    const input = { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 5_000, reason: 'concurrency test' };
    const results = await Promise.allSettled([service.issue(input), service.issue(input)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const refundCount = await db.collection('refunds').countDocuments({ stripePaymentIntentId: STRIPE_PAYMENT_INTENT_ID });
    expect(refundCount).toBe(1);

    // The real proof this test exists for: even though both calls raced past the DB pre-check and
    // both reached Stripe, the deterministic idempotency key meant Stripe itself returned the one
    // real refund rather than creating two — not just that the DB only *recorded* one.
    expect(stripe.refunds.size).toBe(1);
  });
});
