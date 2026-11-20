import { Model, Types } from 'mongoose';
import { BookingType, PaymentStatus } from '../common';
import { FakeStripeGateway } from './fake-stripe-gateway';
import { Payment } from './schemas/payment.schema';
import { StripePaymentActivity } from './stripe-payment-activity';

/** One fake "document": mutable fields plus a `.save()` that writes back into the fake model's store. */
interface FakePaymentRow {
  bookingType: BookingType;
  bookingId: Types.ObjectId;
  stripePaymentIntentId: string;
  status: PaymentStatus;
  updatedAt: Date;
  createdAt: Date;
  save: () => Promise<void>;
}

/** Minimal in-memory stand-in for `Model<Payment>` — only the calls StripePaymentActivity makes. */
class FakePaymentModel {
  private readonly rows: FakePaymentRow[] = [];

  seed(row: Omit<FakePaymentRow, 'save'>): FakePaymentRow {
    const stored: FakePaymentRow = { ...row, save: async () => undefined };
    stored.save = async () => {
      const index = this.rows.findIndex((r) => r.stripePaymentIntentId === stored.stripePaymentIntentId);
      if (index >= 0) this.rows[index] = stored;
    };
    this.rows.push(stored);
    return stored;
  }

  findOne(filter: { bookingType: BookingType; bookingId: Types.ObjectId; status: { $in: PaymentStatus[] } }) {
    return {
      sort: () => ({
        exec: async () => {
          const matches = this.rows
            .filter(
              (r) =>
                r.bookingType === filter.bookingType &&
                r.bookingId.equals(filter.bookingId) &&
                filter.status.$in.includes(r.status),
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return matches[0] ?? null;
        },
      }),
    };
  }
}

const BOOKING_ID = new Types.ObjectId();
const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('StripePaymentActivity', () => {
  let model: FakePaymentModel;
  let stripe: FakeStripeGateway;
  let activity: StripePaymentActivity;

  beforeEach(() => {
    model = new FakePaymentModel();
    stripe = new FakeStripeGateway();
    activity = new StripePaymentActivity(model as unknown as Model<Payment>, stripe);
  });

  it('expires when nothing is in flight for the booking', async () => {
    const result = await activity.prepareExpiry(BookingType.FLIGHT, BOOKING_ID.toString(), NOW);
    expect(result).toBe('EXPIRE');
  });

  it('expires and cancels the PaymentIntent when only REQUIRES_PAYMENT exists (never paused)', async () => {
    const row = model.seed({
      bookingType: BookingType.FLIGHT,
      bookingId: BOOKING_ID,
      stripePaymentIntentId: 'pi_1',
      status: PaymentStatus.REQUIRES_PAYMENT,
      updatedAt: NOW,
      createdAt: NOW,
    });
    stripe.intents.set('pi_1', { status: 'requires_payment_method', amountCents: 1000, currency: 'usd' });

    const result = await activity.prepareExpiry(BookingType.FLIGHT, BOOKING_ID.toString(), NOW);
    expect(result).toBe('EXPIRE');
    expect(row.status).toBe(PaymentStatus.CANCELLED);
    expect(stripe.intents.get('pi_1')?.status).toBe('canceled');
  });

  it('skips while a PROCESSING payment is within the pause window', async () => {
    model.seed({
      bookingType: BookingType.FLIGHT,
      bookingId: BOOKING_ID,
      stripePaymentIntentId: 'pi_2',
      status: PaymentStatus.PROCESSING,
      updatedAt: NOW,
      createdAt: NOW,
    });

    const within = new Date(NOW.getTime() + 4 * 60_000); // 4 min < PAYMENT_PAUSE_MAX_MINUTES (5)
    const result = await activity.prepareExpiry(BookingType.FLIGHT, BOOKING_ID.toString(), within);
    expect(result).toBe('SKIP');
  });

  it('expires a PROCESSING payment once the pause cap passes and Stripe reports it canceled', async () => {
    const row = model.seed({
      bookingType: BookingType.FLIGHT,
      bookingId: BOOKING_ID,
      stripePaymentIntentId: 'pi_3',
      status: PaymentStatus.PROCESSING,
      updatedAt: NOW,
      createdAt: NOW,
    });
    stripe.intents.set('pi_3', { status: 'processing', amountCents: 1000, currency: 'usd' });

    const pastCap = new Date(NOW.getTime() + 5 * 60_000 + 1);
    const result = await activity.prepareExpiry(BookingType.FLIGHT, BOOKING_ID.toString(), pastCap);
    expect(result).toBe('EXPIRE');
    expect(row.status).toBe(PaymentStatus.CANCELLED);
  });

  it('skips instead of crashing when Stripe is unreachable (GitHub issue #114)', async () => {
    const row = model.seed({
      bookingType: BookingType.FLIGHT,
      bookingId: BOOKING_ID,
      stripePaymentIntentId: 'pi_5',
      status: PaymentStatus.REQUIRES_PAYMENT,
      updatedAt: NOW,
      createdAt: NOW,
    });
    stripe.retrievePaymentIntent = jest.fn().mockRejectedValue(new Error('Stripe is down'));

    const result = await activity.prepareExpiry(BookingType.FLIGHT, BOOKING_ID.toString(), NOW);

    expect(result).toBe('SKIP');
    expect(row.status).toBe(PaymentStatus.REQUIRES_PAYMENT); // untouched — the next sweep tries again
  });

  it('confirms instead of expiring when Stripe reports the payment actually succeeded past the cap', async () => {
    const row = model.seed({
      bookingType: BookingType.HOTEL,
      bookingId: BOOKING_ID,
      stripePaymentIntentId: 'pi_4',
      status: PaymentStatus.PROCESSING,
      updatedAt: NOW,
      createdAt: NOW,
    });
    stripe.intents.set('pi_4', { status: 'processing', amountCents: 1000, currency: 'usd' });
    // Cancelling a Stripe PaymentIntent that actually succeeded in the meantime is a true race;
    // the fake reports 'succeeded' on retrieve regardless of the cancel call, like Stripe would.
    stripe.setStatus('pi_4', 'succeeded');

    const pastCap = new Date(NOW.getTime() + 5 * 60_000 + 1);
    const result = await activity.prepareExpiry(BookingType.HOTEL, BOOKING_ID.toString(), pastCap);
    expect(result).toEqual({ outcome: 'PAID', paymentRef: 'pi_4' });
    expect(row.status).toBe(PaymentStatus.SUCCEEDED);
  });
});
