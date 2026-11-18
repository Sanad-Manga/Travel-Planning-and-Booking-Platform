import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { BookingStatus, BookingType, Role } from '../src/common';
import configuration from '../src/config/configuration';
import { AuthenticatedUser } from '../src/common/interfaces/authenticated-user';
import {
  BookingProviderRegistry,
  Payable,
  PaymentsModule,
  PaymentsService,
  STRIPE_GATEWAY,
} from '../src/payments';
import { FakeStripeGateway } from '../src/payments/fake-stripe-gateway';
import { Payment } from '../src/payments/schemas/payment.schema';

/**
 * PAY-01 checklist: "Concurrency-sensitive code is atomic (no read-then-write) and has a test" —
 * for "only one payment may be in flight per booking" (docs/contracts.md section 8). A unit test
 * with a fake, single-threaded model cannot prove a real race is actually prevented; this fires
 * two genuinely concurrent PaymentsService.create() calls against a real (in-memory) MongoDB and
 * checks the database afterwards, the same way test/hotel-bookings.e2e-spec.ts proves "only one
 * of two parallel holds succeeds" for room holds.
 */
describe('PaymentsService.create concurrency (PAY-01)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryReplSet;
  let db: Connection;
  let service: PaymentsService;

  const USER_ID = new Types.ObjectId().toString();
  const BOOKING_ID = new Types.ObjectId().toString();
  const user: AuthenticatedUser = { userId: USER_ID, role: Role.USER };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [configuration] }),
        MongooseModule.forRoot(mongo.getUri()),
        PaymentsModule,
      ],
    })
      // Real StripePaymentGateway would make a genuine outbound call to Stripe's API — this test
      // is about the database's atomicity guarantee, not Stripe itself, so swap in the fake
      // (same pattern as overriding EXCHANGE_RATE_PROVIDER in fx.service.spec.ts).
      .overrideProvider(STRIPE_GATEWAY)
      .useValue(new FakeStripeGateway())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get<Connection>(getConnectionToken());
    service = app.get(PaymentsService);

    // Mongoose builds schema.index(...) indexes in the BACKGROUND, asynchronously — without this,
    // the race below could run before the unique partial index actually exists and both inserts
    // would wrongly succeed (this is exactly what happened the first time this test was written).
    await app.get(getModelToken(Payment.name)).init();

    // A minimal real BookingProvider for one fixed FLIGHT booking — only getPayable matters here.
    const payable: Payable = {
      amountCents: 15_000,
      currency: 'USD',
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    };
    app.get(BookingProviderRegistry).register(BookingType.FLIGHT, {
      getStatus: async () => null,
      applyStatus: async () => false,
      markConfirmed: async () => false,
      findExpiredHolds: async () => [],
      getPolicies: async () => null,
      getPayable: async (id: string, userId: string) => (id === BOOKING_ID && userId === USER_ID ? payable : null),
    });

    // PolicyAcceptanceService.assertAccepted only checks existence — insert the row it looks for
    // directly, bypassing the accept-policies endpoint (not what this test is about).
    await db.collection('policyAcceptances').insertOne({
      bookingType: BookingType.FLIGHT,
      bookingId: new Types.ObjectId(BOOKING_ID),
      userId: new Types.ObjectId(USER_ID),
      acceptedAt: new Date(),
    });
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it('lets exactly one of two simultaneous payment creations for the same booking succeed', async () => {
    const dto = { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID };
    const results = await Promise.allSettled([service.create(user, dto), service.create(user, dto)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const inFlightCount = await db
      .collection('payments')
      .countDocuments({ bookingId: new Types.ObjectId(BOOKING_ID), status: { $in: ['REQUIRES_PAYMENT', 'PROCESSING'] } });
    expect(inFlightCount).toBe(1);
  });
});
