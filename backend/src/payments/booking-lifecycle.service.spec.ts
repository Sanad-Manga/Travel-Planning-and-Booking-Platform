import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { BookingStatus, BookingType } from '../common';
import {
  BookingLifecycle,
  HOLD_SWEEP_BATCH_SIZE,
} from './booking-lifecycle.service';
import {
  BookingLifecycleProvider,
  BookingStatusSnapshot,
} from './booking-provider.interface';
import { BookingProviderRegistry } from './booking-provider.registry';
import { ALLOWED_TRANSITIONS } from './booking-transitions';

/** In-memory stand-in for a booking owner. applyStatus is an atomic compare-and-set, like the real findOneAndUpdate. */
class FakeProvider implements BookingLifecycleProvider {
  readonly bookings = new Map<string, BookingStatusSnapshot>();
  readonly released: string[] = [];
  readonly failApplyFor = new Set<string>();
  failRelease = false;
  findCalls = 0;

  add(
    id: string,
    status: BookingStatus,
    holdExpiresAt: Date | null = null,
  ): void {
    this.bookings.set(id, { status, holdExpiresAt });
  }

  status(id: string): BookingStatus | undefined {
    return this.bookings.get(id)?.status;
  }

  async getStatus(id: string): Promise<BookingStatusSnapshot | null> {
    const booking = this.bookings.get(id);
    return booking ? { ...booking } : null;
  }

  async applyStatus(
    id: string,
    from: BookingStatus,
    to: BookingStatus,
  ): Promise<boolean> {
    if (this.failApplyFor.has(id)) throw new Error('database down');
    const booking = this.bookings.get(id);
    if (!booking || booking.status !== from) return false;
    booking.status = to;
    return true;
  }

  async findExpiredHolds(now: Date, limit: number): Promise<string[]> {
    this.findCalls++;
    return [...this.bookings.entries()]
      .filter(
        ([, b]) =>
          b.status === BookingStatus.PENDING_PAYMENT &&
          b.holdExpiresAt != null &&
          b.holdExpiresAt <= now,
      )
      .slice(0, limit)
      .map(([id]) => id);
  }

  async markExpired(id: string): Promise<void> {
    if (this.failRelease) throw new Error('release failed');
    this.released.push(id);
  }
}

const NOW = new Date('2026-11-20T12:00:00.000Z');
const PAST = new Date('2026-11-20T11:59:00.000Z');
const FUTURE = new Date('2026-11-20T12:10:00.000Z');
const ALL_STATUSES = Object.values(BookingStatus);

describe('BookingLifecycle', () => {
  let flights: FakeProvider;
  let hotels: FakeProvider;
  let lifecycle: BookingLifecycle;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    flights = new FakeProvider();
    hotels = new FakeProvider();
    const registry = new BookingProviderRegistry();
    registry.register(BookingType.FLIGHT, flights);
    registry.register(BookingType.HOTEL, hotels);
    lifecycle = new BookingLifecycle(registry);
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

    it.each(legal)('allows %s -> %s (flight and hotel)', async (from, to) => {
      flights.add('f1', from);
      hotels.add('h1', from);

      await lifecycle.transition(BookingType.FLIGHT, 'f1', to);
      await lifecycle.transition(BookingType.HOTEL, 'h1', to);

      expect(flights.status('f1')).toBe(to);
      expect(hotels.status('h1')).toBe(to);
    });

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
        expect(flights.released).toEqual([]);
      },
    );

    it('throws 404 for an unknown booking', async () => {
      await expect(
        lifecycle.transition(
          BookingType.HOTEL,
          'missing',
          BookingStatus.CONFIRMED,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets only one of two simultaneous callers win (payment webhook vs expiry)', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);

      const results = await Promise.allSettled([
        lifecycle.transition(BookingType.FLIGHT, 'f1', BookingStatus.CONFIRMED),
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
      // seats are released only if expiry actually won
      expect(flights.released).toEqual(
        flights.status('f1') === BookingStatus.EXPIRED ? ['f1'] : [],
      );
    });

    it('releases seats/rooms exactly once when a booking expires, and not for other moves', async () => {
      hotels.add('h1', BookingStatus.PENDING_PAYMENT, PAST);
      hotels.add('h2', BookingStatus.PENDING_PAYMENT, FUTURE);

      await lifecycle.transition(
        BookingType.HOTEL,
        'h1',
        BookingStatus.EXPIRED,
      );
      await lifecycle.transition(
        BookingType.HOTEL,
        'h2',
        BookingStatus.CONFIRMED,
      );

      expect(hotels.released).toEqual(['h1']);
    });

    it('keeps the EXPIRED status and does not throw when releasing fails', async () => {
      flights.failRelease = true;
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);

      await expect(
        lifecycle.transition(BookingType.FLIGHT, 'f1', BookingStatus.EXPIRED),
      ).resolves.toBeUndefined();
      expect(flights.status('f1')).toBe(BookingStatus.EXPIRED);
    });

    it('fails clearly when no provider is registered for the type', async () => {
      const empty = new BookingLifecycle(new BookingProviderRegistry());
      await expect(
        empty.transition(BookingType.FLIGHT, 'f1', BookingStatus.CONFIRMED),
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
      expect(flights.released).toEqual(['f1']);
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
      expect(flights.released).toEqual(['f-due']);
      expect(hotels.released).toEqual(['h-due']);
    });

    it('is idempotent: a second run changes and releases nothing more', async () => {
      flights.add('f1', BookingStatus.PENDING_PAYMENT, PAST);
      hotels.add('h1', BookingStatus.PENDING_PAYMENT, PAST);

      await lifecycle.sweepExpiredHolds(NOW);
      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(0);

      expect(flights.released).toEqual(['f1']);
      expect(hotels.released).toEqual(['h1']);
    });

    it('works through more due holds than one batch holds', async () => {
      const total = HOLD_SWEEP_BATCH_SIZE * 2 + 50;
      for (let i = 0; i < total; i++)
        flights.add(`f${i}`, BookingStatus.PENDING_PAYMENT, PAST);

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(total);

      expect(
        [...flights.bookings.values()].every(
          (b) => b.status === BookingStatus.EXPIRED,
        ),
      ).toBe(true);
      expect(flights.released).toHaveLength(total);
    });

    it('keeps going when one booking fails, and stops when nothing can progress', async () => {
      flights.add('bad', BookingStatus.PENDING_PAYMENT, PAST);
      flights.add('good', BookingStatus.PENDING_PAYMENT, PAST);
      flights.failApplyFor.add('bad');

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(1);

      expect(flights.status('good')).toBe(BookingStatus.EXPIRED);
      expect(flights.status('bad')).toBe(BookingStatus.PENDING_PAYMENT);
      expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('does not loop forever when every booking in a full batch keeps failing', async () => {
      for (let i = 0; i < HOLD_SWEEP_BATCH_SIZE; i++) {
        flights.add(`f${i}`, BookingStatus.PENDING_PAYMENT, PAST);
        flights.failApplyFor.add(`f${i}`);
      }

      await expect(lifecycle.sweepExpiredHolds(NOW)).resolves.toBe(0);
      expect(flights.findCalls).toBe(1);
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
      expect(flights.released).toEqual(['f1']);
    });
  });
});
