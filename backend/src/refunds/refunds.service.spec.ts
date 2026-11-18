import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { AuthenticatedUser, BookingType, PaymentStatus, RefundStatus, Role } from '../common';
import { NotificationsService, NotifyInput } from '../notifications';
import { FakeStripeGateway } from '../payments/fake-stripe-gateway';
import { Payment, PaymentLean } from '../payments/schemas/payment.schema';
import { RefundsService } from './refunds.service';
import { Refund, RefundLean } from './schemas/refund.schema';

/** Minimal in-memory stand-in for `Model<Payment>` — only the `findOne().sort().exec()` call `issue` makes. */
class FakePaymentModel {
  readonly rows: PaymentLean[] = [];

  add(row: Partial<PaymentLean> & { bookingType: BookingType; bookingId: Types.ObjectId; status: PaymentStatus }): void {
    this.rows.push({
      userId: new Types.ObjectId(),
      stripePaymentIntentId: `pi_${this.rows.length}`,
      amountCents: 25_000,
      currency: 'USD',
      _id: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...row,
    } as PaymentLean);
  }

  findOne(filter: { bookingType: BookingType; bookingId: Types.ObjectId; status: PaymentStatus }) {
    const matches = this.rows.filter(
      (r) => r.bookingType === filter.bookingType && r.bookingId.equals(filter.bookingId) && r.status === filter.status,
    );
    const row = matches[matches.length - 1] ?? null;
    return { sort: () => ({ exec: async () => row }) };
  }
}

/** Minimal in-memory stand-in for `Model<Refund>` — only the calls RefundsService makes. */
class FakeRefundModel {
  readonly rows: RefundLean[] = [];
  forceDuplicateKeyOnce = false;

  async create(doc: Omit<Refund, never>): Promise<RefundLean> {
    if (this.forceDuplicateKeyOnce) {
      this.forceDuplicateKeyOnce = false;
      const err = new Error('duplicate key') as Error & { code: number };
      err.code = 11000;
      throw err;
    }
    const row: RefundLean = { ...doc, _id: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date() } as RefundLean;
    this.rows.push(row);
    return row;
  }

  exists(filter: { stripePaymentIntentId: string }) {
    const found = this.rows.some((r) => r.stripePaymentIntentId === filter.stripePaymentIntentId);
    return { exec: async () => (found ? { _id: new Types.ObjectId() } : null) };
  }

  findOne(filter: { bookingType?: BookingType; bookingId?: Types.ObjectId; stripeRefundId?: string; status?: RefundStatus }) {
    const match = (r: RefundLean) =>
      (filter.bookingType === undefined || r.bookingType === filter.bookingType) &&
      (filter.bookingId === undefined || r.bookingId.equals(filter.bookingId)) &&
      (filter.stripeRefundId === undefined || r.stripeRefundId === filter.stripeRefundId) &&
      (filter.status === undefined || r.status === filter.status);
    const matches = this.rows.filter(match);
    const row = matches[matches.length - 1] ?? null;
    const withSave = row
      ? {
          ...row,
          save: async () => {
            const index = this.rows.findIndex((r) => r._id.equals(row._id));
            this.rows[index] = { ...this.rows[index], status: row.status };
          },
          set status(value: RefundStatus) {
            row.status = value;
          },
          get status() {
            return row.status;
          },
        }
      : null;
    return { sort: () => ({ lean: () => ({ exec: async () => row }) }), exec: async () => withSave };
  }

  findById(id: string) {
    const row = Types.ObjectId.isValid(id) ? this.rows.find((r) => r._id.toString() === id) ?? null : null;
    return { lean: () => ({ exec: async () => (row ? { ...row } : null) }) };
  }
}

class FakeNotificationsService {
  readonly sent: NotifyInput[] = [];
  async notify(input: NotifyInput): Promise<void> {
    this.sent.push(input);
  }
}

function refundUpdatedEvent(refundId: string, status: string): Stripe.Event {
  return { type: 'refund.updated', data: { object: { id: refundId, status } } } as unknown as Stripe.Event;
}

function user(userId: string): AuthenticatedUser {
  return { userId, role: Role.USER };
}

describe('RefundsService', () => {
  const BOOKING_ID = new Types.ObjectId();
  let payments: FakePaymentModel;
  let refundModel: FakeRefundModel;
  let stripe: FakeStripeGateway;
  let notifications: FakeNotificationsService;
  let service: RefundsService;

  beforeEach(() => {
    payments = new FakePaymentModel();
    refundModel = new FakeRefundModel();
    stripe = new FakeStripeGateway();
    notifications = new FakeNotificationsService();
    service = new RefundsService(
      refundModel as unknown as Model<Refund>,
      payments as unknown as Model<Payment>,
      stripe,
      notifications as unknown as NotificationsService,
    );
  });

  describe('issue', () => {
    it('rejects a zero amount without calling Stripe', async () => {
      await expect(
        service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stripe.refunds.size).toBe(0);
    });

    it('rejects a negative amount without calling Stripe', async () => {
      await expect(
        service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: -500 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stripe.refunds.size).toBe(0);
    });

    it('rejects when no SUCCEEDED payment exists for the booking', async () => {
      await expect(
        service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 5_000 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a refund amount above what was paid', async () => {
      payments.add({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID, status: PaymentStatus.SUCCEEDED, amountCents: 10_000 });
      await expect(
        service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 10_001 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stripe.refunds.size).toBe(0);
    });

    it('rejects issuing a second refund for the same payment', async () => {
      payments.add({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID, status: PaymentStatus.SUCCEEDED, amountCents: 10_000 });
      await service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 5_000 });

      await expect(
        service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 5_000 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stripe.refunds.size).toBe(1);
    });

    it('records REFUNDED immediately when Stripe returns succeeded, and notifies the user', async () => {
      payments.add({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID, status: PaymentStatus.SUCCEEDED, amountCents: 10_000 });

      const result = await service.issue({
        bookingType: BookingType.FLIGHT,
        bookingId: BOOKING_ID.toString(),
        amountCents: 5_000,
        reason: 'Cancelled per tier 2',
      });

      expect(result.status).toBe(RefundStatus.REFUNDED);
      expect(result.amountCents).toBe(5_000);
      expect(notifications.sent).toHaveLength(1);
      expect(notifications.sent[0].type).toBe('REFUND_UPDATE');
    });

    it('records PENDING when Stripe does not settle the refund immediately', async () => {
      payments.add({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID, status: PaymentStatus.SUCCEEDED, amountCents: 10_000 });
      stripe.queueNextRefundStatus('pending');

      const result = await service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 5_000 });

      expect(result.status).toBe(RefundStatus.PENDING);
      expect(notifications.sent).toHaveLength(1);
    });

    it('cancels an orphaned refund race via the unique-index duplicate-key path', async () => {
      payments.add({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID, status: PaymentStatus.SUCCEEDED, amountCents: 10_000 });
      refundModel.forceDuplicateKeyOnce = true;

      await expect(
        service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 5_000 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('applyStripeRefundEvent', () => {
    it('flips a PENDING refund to REFUNDED and notifies once', async () => {
      payments.add({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID, status: PaymentStatus.SUCCEEDED, amountCents: 10_000 });
      stripe.queueNextRefundStatus('pending');
      const issued = await service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 5_000 });
      expect(issued.status).toBe(RefundStatus.PENDING);
      expect(notifications.sent).toHaveLength(1);

      const stored = refundModel.rows.find((r) => r.bookingId.equals(BOOKING_ID))!;
      await service.applyStripeRefundEvent(refundUpdatedEvent(stored.stripeRefundId, 'succeeded'));

      const updated = refundModel.rows.find((r) => r.bookingId.equals(BOOKING_ID))!;
      expect(updated.status).toBe(RefundStatus.REFUNDED);
      expect(notifications.sent).toHaveLength(2);
    });

    it('is a no-op for an unknown refund id', async () => {
      await expect(service.applyStripeRefundEvent(refundUpdatedEvent('re_unknown', 'succeeded'))).resolves.toBeUndefined();
      expect(notifications.sent).toHaveLength(0);
    });

    it('is idempotent for an already-terminal refund (no duplicate notification)', async () => {
      payments.add({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID, status: PaymentStatus.SUCCEEDED, amountCents: 10_000 });
      await service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 5_000 });
      expect(notifications.sent).toHaveLength(1);

      const stored = refundModel.rows.find((r) => r.bookingId.equals(BOOKING_ID))!;
      await service.applyStripeRefundEvent(refundUpdatedEvent(stored.stripeRefundId, 'succeeded'));

      expect(notifications.sent).toHaveLength(1); // still terminal from `issue` itself — no second notify
    });
  });

  describe('getLatestForBooking / getById', () => {
    it('returns null when no refund exists for the booking', async () => {
      await expect(service.getLatestForBooking(BookingType.FLIGHT, BOOKING_ID.toString())).resolves.toBeNull();
    });

    it('returns 404 for a refund belonging to another user', async () => {
      payments.add({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID, status: PaymentStatus.SUCCEEDED, amountCents: 10_000 });
      const issued = await service.issue({ bookingType: BookingType.FLIGHT, bookingId: BOOKING_ID.toString(), amountCents: 5_000 });

      await expect(service.getById(user(new Types.ObjectId().toString()), issued.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
