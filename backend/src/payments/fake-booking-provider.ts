import { BookingStatus } from '../common';
import {
  BookingPolicies,
  BookingProvider,
  BookingStatusSnapshot,
  Payable,
} from './booking-provider.interface';

/**
 * In-memory stand-in for a booking owner, shared by booking-lifecycle.service.spec.ts and
 * booking-provider.conformance.spec.ts. `applyStatus` is an atomic compare-and-set, like the
 * real findOneAndUpdate; `findExpiredHolds` is ordered by insertion (stand-in for ascending _id)
 * so the `afterId` cursor behaves like it would against a real, sorted collection.
 */
export class FakeBookingProvider implements BookingProvider {
  readonly bookings = new Map<string, BookingStatusSnapshot>();
  readonly failApplyFor = new Set<string>();
  readonly paymentRefs = new Map<string, string>();
  readonly policies = new Map<string, BookingPolicies>();
  readonly payables = new Map<string, Payable & { ownerId: string }>();
  findCalls = 0;

  add(
    id: string,
    status: BookingStatus,
    holdExpiresAt: Date | null = null,
  ): void {
    this.bookings.set(id, { status, holdExpiresAt });
  }

  /** Seed what `getPolicies(id)` returns for `id` (PAY-02 test double). */
  setPolicies(id: string, policies: BookingPolicies): void {
    this.policies.set(id, policies);
  }

  /** Seed what `getPayable(id, ownerId)` returns for `id` (PAY-01 test double). */
  setPayable(id: string, ownerId: string, amountCents: number, currency = 'USD'): void {
    this.payables.set(id, { ownerId, amountCents, currency, status: BookingStatus.PENDING_PAYMENT, holdExpiresAt: null });
  }

  async getPayable(id: string, userId: string): Promise<Payable | null> {
    const payable = this.payables.get(id);
    const booking = this.bookings.get(id);
    if (!payable || !booking || payable.ownerId !== userId) return null;
    return { amountCents: payable.amountCents, currency: payable.currency, status: booking.status, holdExpiresAt: booking.holdExpiresAt ?? null };
  }

  async getPolicies(id: string): Promise<BookingPolicies | null> {
    const policies = this.policies.get(id);
    return policies ? { ...policies } : null;
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

  async markConfirmed(id: string, paymentRef: string): Promise<boolean> {
    const booking = this.bookings.get(id);
    if (!booking) return false;
    if (booking.status === BookingStatus.CONFIRMED) {
      return this.paymentRefs.get(id) === paymentRef; // idempotent for the same payment
    }
    if (booking.status !== BookingStatus.PENDING_PAYMENT) return false;
    booking.status = BookingStatus.CONFIRMED;
    booking.holdExpiresAt = null;
    this.paymentRefs.set(id, paymentRef);
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
