import { ConflictException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { BookingStatus, BookingType, PaymentStatus, Role } from '../common';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user';
import { BookingLifecycle } from './booking-lifecycle.service';
import { BookingProviderRegistry } from './booking-provider.registry';
import { FakeBookingProvider } from './fake-booking-provider';
import { FakeStripeGateway } from './fake-stripe-gateway';
import { PaymentActivity } from './payment-activity';
import { PaymentsService } from './payments.service';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import { Payment, PaymentLean } from './schemas/payment.schema';
import { PolicyAcceptance, PolicyAcceptanceLean } from './schemas/policy-acceptance.schema';

/** Never expires on its own in these tests — only confirmPaid/transition (called directly) matter. */
class NeverExpirePaymentActivity implements PaymentActivity {
  async prepareExpiry(): Promise<'SKIP'> {
    return 'SKIP';
  }
}

/** Minimal in-memory stand-in for `Model<Payment>` — only the calls PaymentsService/handleWebhookEvent make. */
class FakePaymentModel {
  private readonly rows: PaymentLean[] = [];

  async create(doc: Omit<Payment, never>): Promise<PaymentLean> {
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

  updateOne(filter: { stripePaymentIntentId: string; status: { $ne: PaymentStatus } }, update: { $set: { status: PaymentStatus } }) {
    const row = this.rows.find((r) => r.stripePaymentIntentId === filter.stripePaymentIntentId && r.status !== filter.status.$ne);
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

function paymentIntentEvent(type: string, id: string): Stripe.Event {
  return { type, data: { object: { id } } } as unknown as Stripe.Event;
}

describe('PaymentsService', () => {
  let flights: FakeBookingProvider;
  let stripe: FakeStripeGateway;
  let paymentModel: FakePaymentModel;
  let policyModel: Map<string, PolicyAcceptanceLean>;
  let service: PaymentsService;
  let lifecycle: BookingLifecycle;

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
    service = new PaymentsService(
      paymentModel as unknown as Model<Payment>,
      registry,
      policyAcceptance,
      lifecycle,
      stripe,
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

    it('does not throw when the booking can no longer be confirmed (already expired) — known PAY-03 gap', async () => {
      acceptPolicies();
      const created = await service.create(user(OWNER_ID), { bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID });
      const row = (await paymentModel.findById(created.id).lean().exec()) as PaymentLean;

      // The booking expired while the payment was in flight.
      flights.bookings.set(BOOKING_ID, { status: BookingStatus.EXPIRED, holdExpiresAt: null });

      await expect(
        service.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', row.stripePaymentIntentId)),
      ).resolves.toBeUndefined();
    });

    it('ignores an unknown PaymentIntent id', async () => {
      await expect(
        service.handleWebhookEvent(paymentIntentEvent('payment_intent.succeeded', 'pi_unknown')),
      ).resolves.toBeUndefined();
    });
  });
});
