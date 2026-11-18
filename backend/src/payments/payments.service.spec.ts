import { ConflictException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { BookingStatus, BookingType, PaymentStatus, Role } from '../common';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user';
import { BookingLifecycle } from './booking-lifecycle.service';
import { BookingProvider } from './booking-provider.interface';
import { BookingProviderRegistry } from './booking-provider.registry';
import { FakeBookingProvider } from './fake-booking-provider';
import { FakeStripeGateway } from './fake-stripe-gateway';
import { PaymentActivity } from './payment-activity';
import { PaymentsService } from './payments.service';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import { Payment, PaymentLean } from './schemas/payment.schema';
import { PolicyAcceptance, PolicyAcceptanceLean } from './schemas/policy-acceptance.schema';
import { IssueRefundInput, RefundsService } from '../refunds/refunds.service';

/** Hand-rolled stand-in for RefundsService — only the two methods PaymentsService calls. */
class FakeRefundsService {
  readonly issued: IssueRefundInput[] = [];

  async issue(input: IssueRefundInput) {
    this.issued.push(input);
    return {} as Awaited<ReturnType<RefundsService['issue']>>;
  }

  async applyStripeRefundEvent(): Promise<void> {}
}

/** Never expires on its own in these tests — only confirmPaid/transition (called directly) matter. */
class NeverExpirePaymentActivity implements PaymentActivity {
  async prepareExpiry(): Promise<'SKIP'> {
    return 'SKIP';
  }
}

/** Minimal in-memory stand-in for `Model<Payment>` — only the calls PaymentsService/handleWebhookEvent make. */
class FakePaymentModel {
  private readonly rows: PaymentLean[] = [];

  /** Test helper: make the NEXT create() throw a Mongo duplicate-key error instead of inserting. */
  forceDuplicateKeyOnce = false;

  async create(doc: Omit<Payment, never>): Promise<PaymentLean> {
    if (this.forceDuplicateKeyOnce) {
      this.forceDuplicateKeyOnce = false;
      const err = new Error('duplicate key') as Error & { code: number };
      err.code = 11000;
      throw err;
    }
    const row: PaymentLean = {
      ...doc,
      _id: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as PaymentLean;
    this.rows.push(row);
    return row;
  }

  exists(filter: { bookingType: BookingType; bookingId: Types.ObjectId; status: { $in: PaymentStatus[] } }) {
    const found = this.rows.some(
      (r) => r.bookingType === filter.bookingType && r.bookingId.equals(filter.bookingId) && filter.status.$in.includes(r.status),
    );
    return { exec: async () => (found ? { _id: new Types.ObjectId() } : null) };
  }

  findById(id: string) {
    const row = Types.ObjectId.isValid(id) ? this.rows.find((r) => r._id.toString() === id) ?? null : null;
    return { lean: () => ({ exec: async () => (row ? { ...row } : null) }) };
  }

  findOne(filter: { stripePaymentIntentId: string }) {
    const row = this.rows.find((r) => r.stripePaymentIntentId === filter.stripePaymentIntentId) ?? null;
    if (!row) return { exec: async () => null };
    return {
      exec: async () => ({
        ...row,
        save: async () => {
          const index = this.rows.findIndex((r) => r._id.equals(row._id));
          this.rows[index] = { ...this.rows[index], status: row.status };
        },
        set status(value: PaymentStatus) {
          row.status = value;
        },
        get status() {
          return row.status;
        },
      }),
    };
  }

  updateOne(filter: { stripePaymentIntentId: string; status: { $in: PaymentStatus[] } }, update: { $set: { status: PaymentStatus } }) {
    const row = this.rows.find((r) => r.stripePaymentIntentId === filter.stripePaymentIntentId && filter.status.$in.includes(r.status));
    if (row) row.status = update.$set.status;
    return { exec: async () => undefined };
  }
}

const OWNER_ID = new Types.ObjectId().toString();
const OTHER_USER_ID = new Types.ObjectId().toString();
const BOOKING_ID = new Types.ObjectId().toString();

function user(userId: string): AuthenticatedUser {
  return { userId, role: Role.USER };
}

function paymentIntentEvent(type: string, id: string, amount = 25_000, currency = 'usd'): Stripe.Event {
  return { type, data: { object: { id, amount, currency } } } as unknown as Stripe.Event;
}

describe('PaymentsService', () => {
  let flights: FakeBookingProvider;
  let stripe: FakeStripeGateway;
  let paymentModel: FakePaymentModel;
  let policyModel: Map<string, PolicyAcceptanceLean>;
  let service: PaymentsService;
  let lifecycle: BookingLifecycle;
  let refunds: FakeRefundsService;

  beforeEach(() => {
    flights = new FakeBookingProvider();
    flights.add(BOOKING_ID, BookingStatus.PENDING_PAYMENT, new Date(Date.now() + 10 * 60_000));
    flights.setPayable(BOOKING_ID, OWNER_ID, 25_000, 'USD');

    const registry = new BookingProviderRegistry();
    registry.register(BookingType.FLIGHT, flights);

    lifecycle = new BookingLifecycle(registry, new NeverExpirePaymentActivity());

    policyModel = new Map();
    const fakePolicyModel = {
      exists: (filter: { bookingType: BookingType; bookingId: Types.ObjectId }) => ({
        exec: async () => (policyModel.has(`${filter.bookingType}:${filter.bookingId.toString()}`) ? {} : null),
      }),
    };
    const policyAcceptance = new PolicyAcceptanceService(registry, fakePolicyModel as unknown as Model<PolicyAcceptance>);

    stripe = new FakeStripeGateway();
    paymentModel = new FakePaymentModel();
    refunds = new FakeRefundsService();
    service = new PaymentsService(
      paymentModel as unknown as Model<Payment>,
      registry,
      policyAcceptance,
      lifecycle,
      stripe,
      refunds as unknown as RefundsService,
    );
  });

  function acceptPolicies(): void {
    policyModel.set(`${BookingType.FLIGHT}:${BOOKING_ID}`, {} as PolicyAcceptanceLean);
  }

  describe('create', () => {
    it('creates a PaymentIntent and returns a clientSecret once policies are accepted', async () => {
      acceptPolicies();
      const result = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      expect(result.amountCents).toBe(25_000);
      expect(result.currency).toBe('USD');
      expect(result.status).toBe(PaymentStatus.REQUIRES_PAYMENT);
      expect(result.clientSecret).toMatch(/_secret$/);
    });

    it('rejects with 409 when policies were never accepted', async () => {
      await expect(service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects with 404 when the caller does not own the booking', async () => {
      acceptPolicies();
      await expect(
        service.create(user(OTHER_USER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with 409 when a payment is already in flight for the booking', async () => {
      acceptPolicies();
      await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      await expect(
        service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects with 404 (never a 409 leaking that a payment is in flight) for a stranger', async () => {
      acceptPolicies();
      await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      await expect(
        service.create(user(OTHER_USER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cancels its own just-created Stripe PaymentIntent when it loses the in-flight race at the database', async () => {
      acceptPolicies();
      paymentModel.forceDuplicateKeyOnce = true;
      await expect(
        service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(stripe.intents.size).toBe(1);
      const [orphaned] = [...stripe.intents.values()];
      expect(orphaned.status).toBe('canceled');
    });

    it('rejects with 409 for a booking type whose provider has no getPayable at all (defensive gap handling)', async () => {
      // getPayable is optional on BookingProvider precisely for a type that genuinely has no
      // implementation yet — simulate that with a provider that omits the method entirely,
      // since every FakeBookingProvider in this codebase already implements it for real.
      const bareProvider = {
        getStatus: async () => null,
        applyStatus: async () => false,
        markConfirmed: async () => false,
        findExpiredHolds: async () => [],
        getPolicies: async () => null,
      };
      const registry = new BookingProviderRegistry();
      registry.register(BookingType.HOTEL, bareProvider);
      const policyAcceptance = new PolicyAcceptanceService(
        registry,
        { exists: () => ({ exec: async () => ({}) }) } as unknown as Model<PolicyAcceptance>,
      );
      const hotelService = new PaymentsService(
        new FakePaymentModel() as unknown as Model<Payment>,
        registry,
        policyAcceptance,
        new BookingLifecycle(registry, new NeverExpirePaymentActivity()),
        new FakeStripeGateway(),
        new FakeRefundsService() as unknown as RefundsService,
      );
      await expect(
        hotelService.create(user(OWNER_ID), { bookingType: BookingType.HOTEL, bookingId: BOOKING_ID }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('retry', () => {
    it('creates a new PaymentIntent once the previous one failed', async () => {
      acceptPolicies();
      const first = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const firstRow = (await paymentModel.findById(first.id).lean().exec()) as PaymentLean;
      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.payment_failed', firstRow.stripePaymentIntentId));

      const retried = await service.retry(user(OWNER_ID), first.id);
      expect(retried.id).not.toBe(first.id);
      expect(retried.status).toBe(PaymentStatus.REQUIRES_PAYMENT);
    });

    it('rejects retrying a payment that is not FAILED/CANCELLED', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      await expect(service.retry(user(OWNER_ID), created.id)).rejects.toBeInstanceOf(ConflictException);
    });

    it('cancels the previous PaymentIntent so it cannot be paid alongside the new one (double charge)', async () => {
      acceptPolicies();
      const first = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const firstRow = (await paymentModel.findById(first.id).lean().exec()) as PaymentLean;
      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.payment_failed', firstRow.stripePaymentIntentId));

      await service.retry(user(OWNER_ID), first.id);

      expect(stripe.intents.get(firstRow.stripePaymentIntentId)?.status).toBe('canceled');
    });

    it('rejects retrying once the booking hold has actually expired', async () => {
      acceptPolicies();
      const first = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const firstRow = (await paymentModel.findById(first.id).lean().exec()) as PaymentLean;
      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.payment_failed', firstRow.stripePaymentIntentId));

      // The hold itself (not just the payment) has now expired — retry must not get a fresh intent.
      flights.bookings.set(BOOKING_ID, { status: BookingStatus.PENDING_PAYMENT, holdExpiresAt: new Date(Date.now() - 1_000) });

      await expect(service.retry(user(OWNER_ID), first.id)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('handleWebhookEvent', () => {
    it('confirms the booking via BookingLifecycle.confirmPaid on payment_intent.succeeded', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const row = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;

      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', row.stripePaymentIntentId));

      expect(flights.status(BOOKING_ID)).toBe(BookingStatus.CONFIRMED);
      const updated = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;
      expect(updated.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('is idempotent: a repeated succeeded event does not throw or double-confirm', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const row = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;

      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', row.stripePaymentIntentId));
      await expect(
        service.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', row.stripePaymentIntentId)),
      ).resolves.toBeUndefined();
      expect(flights.status(BOOKING_ID)).toBe(BookingStatus.CONFIRMED);
    });

    it('marks the payment FAILED on payment_intent.payment_failed without touching the booking', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const row = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;

      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.payment_failed', row.stripePaymentIntentId));

      expect(flights.status(BOOKING_ID)).toBe(BookingStatus.PENDING_PAYMENT);
      const updated = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;
      expect(updated.status).toBe(PaymentStatus.FAILED);
    });

    it('ignores a late payment_intent.processing event that arrives after payment_failed', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const row = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;

      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.payment_failed', row.stripePaymentIntentId));
      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.processing', row.stripePaymentIntentId));

      const updated = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;
      expect(updated.status).toBe(PaymentStatus.FAILED);
    });

    it('issues a refund when the booking can no longer be confirmed (already expired)', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const row = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;

      // The booking expired while the payment was in flight.
      flights.bookings.set(BOOKING_ID, { status: BookingStatus.EXPIRED, holdExpiresAt: null });

      await expect(
        service.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', row.stripePaymentIntentId)),
      ).resolves.toBeUndefined();

      expect(refunds.issued).toEqual([
        { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID, amountCents: 25_000, reason: expect.any(String) },
      ]);
    });

    it('ignores an unknown PaymentIntent id', async () => {
      await expect(
        service.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', 'pi_unknown')),
      ).resolves.toBeUndefined();
    });

    it('marks the payment PROCESSING on payment_intent.processing without touching the booking', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const row = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;

      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.processing', row.stripePaymentIntentId));

      expect(flights.status(BOOKING_ID)).toBe(BookingStatus.PENDING_PAYMENT);
      const updated = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;
      expect(updated.status).toBe(PaymentStatus.PROCESSING);
    });

    it('does not confirm the booking when the Stripe amount disagrees with the stored amount', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const row = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;

      await service.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', row.stripePaymentIntentId, 1, 'usd'));

      expect(flights.status(BOOKING_ID)).toBe(BookingStatus.PENDING_PAYMENT); // not confirmed
      const updated = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;
      expect(updated.status).toBe(PaymentStatus.SUCCEEDED); // money was genuinely collected, stays visible
    });

    it('does not mark the payment SUCCEEDED when confirmPaid fails transiently, so a retried webhook delivery still confirms the booking', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const row = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;

      // A booking provider whose markConfirmed fails once with a transient (non-Conflict/NotFound)
      // error, then behaves normally — simulates a DB hiccup during the first webhook delivery.
      let failNext = true;
      const flaky: BookingProvider = {
        getStatus: (id) => flights.getStatus(id),
        applyStatus: (id, from, to) => flights.applyStatus(id, from, to),
        markConfirmed: async (id, ref) => {
          if (failNext) {
            failNext = false;
            throw new Error('transient database hiccup');
          }
          return flights.markConfirmed(id, ref);
        },
        findExpiredHolds: (now, limit, afterId) => flights.findExpiredHolds(now, limit, afterId),
        getPolicies: (id) => flights.getPolicies(id),
        getPayable: (id, userId) => flights.getPayable(id, userId),
      };
      const flakyRegistry = new BookingProviderRegistry();
      flakyRegistry.register(BookingType.FLIGHT, flaky);
      // handleWebhookEvent (the only method called on flakyService below) never touches
      // PolicyAcceptanceService — a throwaway instance is enough to satisfy the constructor.
      const unusedPolicyAcceptance = new PolicyAcceptanceService(
        flakyRegistry,
        { exists: () => ({ exec: async () => null }) } as unknown as Model<PolicyAcceptance>,
      );
      const flakyService = new PaymentsService(
        paymentModel as unknown as Model<Payment>,
        flakyRegistry,
        unusedPolicyAcceptance,
        new BookingLifecycle(flakyRegistry, new NeverExpirePaymentActivity()),
        stripe,
        refunds as unknown as RefundsService,
      );

      await expect(
        flakyService.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', row.stripePaymentIntentId)),
      ).rejects.toThrow('transient database hiccup');

      // Not marked SUCCEEDED after the transient failure — Stripe's retry must still reach confirmPaid.
      const afterFailure = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;
      expect(afterFailure.status).toBe(PaymentStatus.REQUIRES_PAYMENT);
      expect(flights.status(BOOKING_ID)).toBe(BookingStatus.PENDING_PAYMENT);

      // Stripe retries the same webhook delivery; this time confirmPaid succeeds.
      await flakyService.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', row.stripePaymentIntentId));

      expect(flights.status(BOOKING_ID)).toBe(BookingStatus.CONFIRMED);
      const afterRetry = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;
      expect(afterRetry.status).toBe(PaymentStatus.SUCCEEDED);
    });
  });
});
