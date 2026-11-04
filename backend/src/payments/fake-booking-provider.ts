import { BookingStatus } from '../common';
import { BookingProvider, BookingStatusSnapshot } from './booking-provider.interface';

/**
 * In-memory stand-in for a booking owner, shared by booking-lifecycle.service.spec.ts and
 * booking-provider.conformance.spec.ts. `applyStatus` is an atomic compare-and-set, like the
 * real findOneAndUpdate; `findExpiredHolds` is ordered by insertion (stand-in for ascending _id)
 * so the `afterId` cursor behaves like it would against a real, sorted collection.
 */
export class FakeBookingProvider implements BookingProvider {
  readonly bookings = new Map<string, BookingStatusSnapshot>();
  readonly failApplyFor = new Set<string>();
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

  async findExpiredHolds(
    now: Date,
    limit: number,
    afterId?: string,
  ): Promise<string[]> {
    this.findCalls++;
    const ids = [...this.bookings.keys()];
    const startAt = afterId ? ids.indexOf(afterId) + 1 : 0;

    const due: string[] = [];
    for (let i = startAt; i < ids.length && due.length < limit; i++) {
      const id = ids[i];
      const b = this.bookings.get(id)!;
      if (
        b.status === BookingStatus.PENDING_PAYMENT &&
        b.holdExpiresAt != null &&
        b.holdExpiresAt <= now
      ) {
        due.push(id);
      }
    }
    return due;
  }
}
