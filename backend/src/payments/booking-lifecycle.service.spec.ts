import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { BookingStatus, BookingType } from '../common';
import {
  BookingLifecycle,
  HOLD_SWEEP_BATCH_SIZE,
} from './booking-lifecycle.service';
import { BookingProviderRegistry } from './booking-provider.registry';
import { ALLOWED_TRANSITIONS } from './booking-transitions';
import { FakeBookingProvider } from './fake-booking-provider';
import { PaymentActivity, PrepareExpiryResult } from './payment-activity';

/**
 * Configurable fake for PaymentActivity. Per booking, queue() takes a sequence of results:
 * the last one repeats forever once the queue is down to one value, so e.g.
 * queue('f1', 'SKIP', 'EXPIRE') answers SKIP once and EXPIRE on every call after
 * (models "still paused" on the first sweep, "the pause ended" on a later one).
 * Defaults to EXPIRE for anything not configured, matching StubPaymentActivity.
 */
class FakePaymentActivity implements PaymentActivity {
  private readonly queues = new Map<string, PrepareExpiryResult[]>();
  readonly calls: string[] = [];

  queue(bookingId: string, ...results: PrepareExpiryResult[]): void {
    this.queues.set(bookingId, [...results]);
  }

  async prepareExpiry(
    _type: BookingType,
    bookingId: string,
  ): Promise<PrepareExpiryResult> {
    this.calls.push(bookingId);
    const q = this.queues.get(bookingId);
    if (!q || q.length === 0) return 'EXPIRE';
    return q.length > 1 ? q.shift()! : q[0];
  }
}

const NOW = new Date('2026-11-20T12:00:00.000Z');
const PAST = new Date('2026-11-20T11:59:00.000Z');
const FUTURE = new Date('2026-11-20T12:10:00.000Z');
const PAID: PrepareExpiryResult = { outcome: 'PAID', paymentRef: 'pi_1' };
const ALL_STATUSES = Object.values(BookingStatus);

describe('BookingLifecycle', () => {
  let flights: FakeBookingProvider;
  let hotels: FakeBookingProvider;
  let paymentActivity: FakePaymentActivity;
  let lifecycle: BookingLifecycle;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    flights = new FakeBookingProvider();
    hotels = new FakeBookingProvider();
    paymentActivity = new FakePaymentActivity();
    const registry = new BookingProviderRegistry();
    registry.register(BookingType.FLIGHT, flights);
    registry.register(BookingType.HOTEL, hotels);
    lifecycle = new BookingLifecycle(registry, paymentActivity);
  });

  afterEach(() => {
    errorLog.mockRestore();
  });

  describe('transition', () => {
    const legal: Array<[BookingStatus, BookingStatus]> = [
      [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
      [BookingStatus.CONFIRMED, BookingStatus.COMPLETED],
      [BookingStatus.PENDING_PAYMENT, BookingStatus.EXPIRED],
      [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
    ];

    // PENDING_PAYMENT -> CONFIRMED is legal in the table but only via confirmPaid() (it needs a paymentRef).
    const viaTransition = legal.filter(
      ([, to]) => to !== BookingStatus.CONFIRMED,
    );

    it.each(viaTransition)(
      'allows %s -> %s (flight and hotel)',
      async (from, to) => {
        flights.add('f1', from);
        hotels.add('h1', from);

        await lifecycle.transition(BookingType.FLIGHT, 'f1', to);
        await lifecycle.transition(BookingType.HOTEL, 'h1', to);

        expect(flights.status('f1')).toBe(to);
        expect(hotels.status('h1')).toBe(to);
      },
    );

    it('matches the contract table: exactly the four legal moves', () => {
      const pairs = ALL_STATUSES.flatMap((from) =>
        ALLOWED_TRANSITIONS[from].map((to) => [from, to]),
      );
      expect(pairs).toHaveLength(legal.length);
    });

    const illegal = ALL_STATUSES.flatMap((from) =>
      ALL_STATUSES.filter((to) => !ALLOWED_TRANSITIONS[from].includes(to)).map(
        (to) => [from, to] as [BookingStatus, BookingStatus],
      ),
    );

    it.each(illegal)(
      'rejects %s -> %s with 409 and changes nothing',
      async (from, to) => {
        flights.add('f1', from);

        await expect(
          lifecycle.transition(BookingType.FLIGHT, 'f1', to),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(flights.status('f1')).toBe(from);
      },
    );

    it('rejects a bare transition to CONFIRMED (contracts v1.3: use confirmPaid)', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);
      await expect(
        lifecycle.transition(BookingType.FLIGHT, 'f1', BookingStatus.CONFIRMED),
      ).rejects.toThrow(/confirmPaid/);
      expect(flights.status('f1')).toBe(BookingStatus.PENDING_PAYMENT);
    });

    it('throws 404 for an unknown booking', async () => {
      await expect(
        lifecycle.transition(
          BookingType.HOTEL,
          'missing',
          BookingStatus.EXPIRED,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets only one of two simultaneous callers win (payment webhook vs expiry)', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);

      const results = await Promise.allSettled([
        lifecycle.confirmPaid(BookingType.FLIGHT, 'f1', 'pi_1'),
        lifecycle.transition(BookingType.FLIGHT, 'f1', BookingStatus.EXPIRED),
      ]);

      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0].reason).toBeInstanceOf(ConflictException);
      expect([BookingStatus.CONFIRMED, BookingStatus.EXPIRED]).toContain(
        flights.status('f1'),
      );
    });

    it('fails clearly when no provider is registered for the type', async () => {
      const empty = new BookingLifecycle(
        new BookingProviderRegistry(),
        paymentActivity,
      );
      await expect(
        empty.transition(BookingType.FLIGHT, 'f1', BookingStatus.EXPIRED),
      ).rejects.toThrow('No booking provider registered for FLIGHT');
    });
  });

  describe('expireIfDue (lazy check on read)', () => {
    it('expires a PENDING_PAYMENT booking whose hold has run out', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);

      await expect(
        lifecycle.expireIfDue(BookingType.FLIGHT, 'f1', NOW),
      ).resolves.toBe(true);

      expect(flights.status('f1')).toBe(BookingStatus.EXPIRED);
    });

    it('expires a booking at exactly the hold expiry instant (no payment ever started)', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, NOW);

      await expect(
        lifecycle.expireIfDue(BookingType.FLIGHT, 'f1', NOW),
      ).resolves.toBe(true);
      expect(flights.status('f1')).toBe(BookingStatus.EXPIRED);
    });

    it('does nothing while the hold is still valid', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, FUTURE);

      await expect(
        lifecycle.expireIfDue(BookingType.FLIGHT, 'f1', NOW),
      ).resolves.toBe(false);
      expect(flights.status('f1')).toBe(BookingStatus.PENDING_PAYMENT);
    });

    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
      BookingStatus.COMPLETED,
    ])('leaves a %s booking alone', async (status) => {
      hotels.add('h1', status, PAST);
      await expect(
        lifecycle.expireIfDue(BookingType.HOTEL, 'h1', NOW),
      ).resolves.toBe(false);
      expect(hotels.status('h1')).toBe(status);
    });

    it('returns false for an unknown booking instead of throwing', async () => {
      await expect(
        lifecycle.expireIfDue(BookingType.HOTEL, 'missing', NOW),
      ).resolves.toBe(false);
    });

    it('leaves a booking alone while its payment is PROCESSING and in the pause window (SKIP)', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);
      paymentActivity.queue('f1', 'SKIP');

      await expect(
        lifecycle.expireIfDue(BookingType.FLIGHT, 'f1', NOW),
      ).resolves.toBe(false);
      expect(flights.status('f1')).toBe(BookingStatus.PENDING_PAYMENT);
    });

    it('confirms instead of expiring when PaymentActivity reports PAID (e.g. a cancel-reveals-succeeded race)', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);
      paymentActivity.queue('f1', PAID);

      await expect(
        lifecycle.expireIfDue(BookingType.FLIGHT, 'f1', NOW),
      ).resolves.toBe(true);
      expect(flights.status('f1')).toBe(BookingStatus.CONFIRMED);
      expect(flights.paymentRefs.get('f1')).toBe('pi_1'); // confirmed through markConfirmed, with the reference
    });
  });

  describe('confirmPaid', () => {
    it('confirms through the owner and stores the payment reference', async () => {
      hotels.add('h1', BookingStatus.PENDING_PAYMENT, FUTURE);
      await lifecycle.confirmPaid(BookingType.HOTEL, 'h1', 'pi_9');
      expect(hotels.status('h1')).toBe(BookingStatus.CONFIRMED);
      expect(hotels.paymentRefs.get('h1')).toBe('pi_9');
    });

    it('is idempotent for the same payment (webhook and late-paid path both arrive)', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, FUTURE);
      await lifecycle.confirmPaid(BookingType.FLIGHT, 'f1', 'pi_9');
      await expect(
        lifecycle.confirmPaid(BookingType.FLIGHT, 'f1', 'pi_9'),
      ).resolves.toBeUndefined();
    });

    it('404 for an unknown booking, 409 once the booking has expired', async () => {
      await expect(
        lifecycle.confirmPaid(BookingType.FLIGHT, 'nope', 'pi_9'),
      ).rejects.toBeInstanceOf(NotFoundException);
      flights.add('f1', BookingStatus.EXPIRED);
      await expect(
        lifecycle.confirmPaid(BookingType.FLIGHT, 'f1', 'pi_9'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(flights.status('f1')).toBe(BookingStatus.EXPIRED);
    });
  });

  describe('sweepExpiredHolds', () => {
    it('expires only due holds, for both flights and hotels', async () => {
      flights.add('f-due', BookingStatus.PENDING_PAYMENT, PAST);
      flights.add('f-later', BookingStatus.PENDING_PAYMENT, FUTURE);
      flights.add('f-paid', BookingStatus.CONFIRMED, PAST);
      hotels.add('h-due', BookingStatus.PENDING_PAYMENT, PAST);

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(2);

      expect(flights.status('f-due')).toBe(BookingStatus.EXPIRED);
      expect(flights.status('f-later')).toBe(BookingStatus.PENDING_PAYMENT);
      expect(flights.status('f-paid')).toBe(BookingStatus.CONFIRMED);
      expect(hotels.status('h-due')).toBe(BookingStatus.EXPIRED);
    });

    it('is idempotent: a second run changes nothing more', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);
      hotels.add('h1', BookingStatus.PENDING_PAYMENT, PAST);

      await lifecycle.sweepExpiredHolds(NOW);
      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(0);
    });

    it('works through more due holds than one batch holds, via the afterId cursor', async () => {
      const total = HOLD_SWEEP_BATCH_SIZE * 2 + 50;
      for (let i = 0; i < total; i++)
        flights.add(`f${i}`, BookingStatus.PENDING_PAYMENT, PAST);

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(total);

      expect(
        [...flights.bookings.values()].every(
          (b) => b.status === BookingStatus.EXPIRED,
        ),
      ).toBe(true);
    });

    it('keeps going when one booking fails, and does not re-fetch it forever', async () => {
      flights.add('bad', BookingStatus.PENDING_PAYMENT, PAST);
      flights.add('good', BookingStatus.PENDING_PAYMENT, PAST);
      flights.failApplyFor.add('bad');

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(1);

      expect(flights.status('good')).toBe(BookingStatus.EXPIRED);
      expect(flights.status('bad')).toBe(BookingStatus.PENDING_PAYMENT);
      expect(errorLog).toHaveBeenCalledTimes(1);
      // only one pass: the cursor moved past "bad" even though it failed
      expect(flights.findCalls).toBe(1);
    });

    it('does not loop forever when every booking in a full batch keeps failing', async () => {
      for (let i = 0; i < HOLD_SWEEP_BATCH_SIZE; i++) {
        flights.add(`f${i}`, BookingStatus.PENDING_PAYMENT, PAST);
        flights.failApplyFor.add(`f${i}`);
      }

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(0);
      // one page of failures, then an empty page proves the cursor moved past all of them
      expect(flights.findCalls).toBe(2);
    });

    it('still sweeps hotels when the flight provider breaks', async () => {
      jest
        .spyOn(flights, 'findExpiredHolds')
        .mockRejectedValue(new Error('flights db down'));
      hotels.add('h1', BookingStatus.PENDING_PAYMENT, PAST);

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(1);
      expect(hotels.status('h1')).toBe(BookingStatus.EXPIRED);
    });

    it('skips a run that starts while the previous one is still going', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);

      const [first, second] = await Promise.all([
        lifecycle.sweepExpiredHolds(NOW),
        lifecycle.sweepExpiredHolds(NOW),
      ]);

      expect(first + second).toBe(1);
      expect(flights.status('f1')).toBe(BookingStatus.EXPIRED);
    });

    it('leaves an in-flight-and-paused booking alone, and does not re-sweep it forever within one run', async () => {
      flights.add('paused', BookingStatus.PENDING_PAYMENT, PAST);
      flights.add('due', BookingStatus.PENDING_PAYMENT, PAST);
      paymentActivity.queue('paused', 'SKIP');

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(1);

      expect(flights.status('paused')).toBe(BookingStatus.PENDING_PAYMENT);
      expect(flights.status('due')).toBe(BookingStatus.EXPIRED);
      // the cursor moved past "paused" once, not re-fetched within this run
      expect(flights.findCalls).toBe(1);
    });

    it('confirms instead of expiring when PaymentActivity reports PAID during a sweep', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);
      paymentActivity.queue('f1', PAID);

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(0); // confirmed, not counted as "expired"
      expect(flights.status('f1')).toBe(BookingStatus.CONFIRMED);
    });

    it('expires a booking whose payment reached FAILED only after the pause deadline, on a later sweep', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);
      // first sweep: still within the pause window (SKIP); a later sweep: the deadline has
      // passed and PaymentActivity now reports EXPIRE for the FAILED payment.
      paymentActivity.queue('f1', 'SKIP', 'EXPIRE');

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(0);
      expect(flights.status('f1')).toBe(BookingStatus.PENDING_PAYMENT);

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(1);
      expect(flights.status('f1')).toBe(BookingStatus.EXPIRED);
    });

    it('still finishes a large batch when some bookings are paused (SKIP) and does not starve the rest', async () => {
      const total = 150;
      for (let i = 0; i < total; i++) {
        flights.add(`f${i}`, BookingStatus.PENDING_PAYMENT, PAST);
        if (i % 3 === 0) paymentActivity.queue(`f${i}`, 'SKIP');
      }

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(100); // 150 - 50 skipped (i % 3 === 0)

      for (let i = 0; i < total; i++) {
        const expected =
          i % 3 === 0 ? BookingStatus.PENDING_PAYMENT : BookingStatus.EXPIRED;
        expect(flights.status(`f${i}`)).toBe(expected);
      }
      // 2 pages (100 + 50): the cursor advanced through every id, skipped or not
      expect(flights.findCalls).toBe(2);
    });
  });
});
