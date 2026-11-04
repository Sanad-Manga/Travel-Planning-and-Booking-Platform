import { BookingStatus } from '../common';
import { BookingProvider } from './booking-provider.interface';

/**
 * Reusable Jest contract tests for any `BookingProvider` implementation — the real Flights B /
 * Hotels B providers as well as this module's own FakeBookingProvider. Call it from your own
 * `*.spec.ts`:
 *
 *   describe('FlightBookingProvider', () =>
 *     runBookingProviderConformanceTests(() => ({
 *       provider: new FlightBookingProvider(flightBookingModel),
 *       unknownId: new Types.ObjectId().toString(),
 *     })),
 *   );
 *
 * `makeFixture` is called before every test and must return a FRESH provider already seeded
 * with exactly one PENDING_PAYMENT booking at id `CONFORMANCE_BOOKING_ID`, whose
 * `holdExpiresAt` is `CONFORMANCE_HOLD_EXPIRES_AT` — plus an id that does not exist
 * (`unknownId`) for the not-found cases. Re-seed on every call rather than reusing state
 * between tests, the same way a real suite would reset its test database per test.
 */
export const CONFORMANCE_BOOKING_ID = 'conformance-booking';
export const CONFORMANCE_HOLD_EXPIRES_AT = new Date('2026-01-01T00:00:00.000Z');

export interface ConformanceFixture {
  provider: BookingProvider;
  /** An id with no booking behind it, for the not-found / false-not-throw cases. */
  unknownId: string;
}

export function runBookingProviderConformanceTests(
  makeFixture: () => Promise<ConformanceFixture> | ConformanceFixture,
): void {
  it('getStatus returns null for an unknown booking', async () => {
    const { provider, unknownId } = await makeFixture();
    await expect(provider.getStatus(unknownId)).resolves.toBeNull();
  });

  it('getStatus returns the seeded booking as PENDING_PAYMENT with its hold', async () => {
    const { provider } = await makeFixture();
    const snapshot = await provider.getStatus(CONFORMANCE_BOOKING_ID);
    expect(snapshot?.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(snapshot?.holdExpiresAt).toEqual(CONFORMANCE_HOLD_EXPIRES_AT);
  });

  it('applyStatus rejects when `from` no longer matches, and changes nothing', async () => {
    const { provider } = await makeFixture();
    const result = await provider.applyStatus(
      CONFORMANCE_BOOKING_ID,
      BookingStatus.CONFIRMED, // wrong `from`: the seeded booking is PENDING_PAYMENT
      BookingStatus.COMPLETED,
    );
    expect(result).toBe(false);
    const after = await provider.getStatus(CONFORMANCE_BOOKING_ID);
    expect(after?.status).toBe(BookingStatus.PENDING_PAYMENT);
  });

  it('applyStatus succeeds atomically when `from` matches', async () => {
    const { provider } = await makeFixture();
    const result = await provider.applyStatus(
      CONFORMANCE_BOOKING_ID,
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.EXPIRED,
    );
    expect(result).toBe(true);
    const after = await provider.getStatus(CONFORMANCE_BOOKING_ID);
    expect(after?.status).toBe(BookingStatus.EXPIRED);
  });

  it('applyStatus returns false, not throw, for an unknown booking', async () => {
    const { provider, unknownId } = await makeFixture();
    await expect(
      provider.applyStatus(
        unknownId,
        BookingStatus.PENDING_PAYMENT,
        BookingStatus.EXPIRED,
      ),
    ).resolves.toBe(false);
  });

  it('findExpiredHolds only returns a PENDING_PAYMENT booking whose hold is at or before `now`', async () => {
    const { provider } = await makeFixture();
    const due = await provider.findExpiredHolds(
      new Date(CONFORMANCE_HOLD_EXPIRES_AT.getTime() + 1),
      10,
    );
    expect(due).toContain(CONFORMANCE_BOOKING_ID);

    const notYetFixture = await makeFixture();
    const notYet = await notYetFixture.provider.findExpiredHolds(
      new Date(CONFORMANCE_HOLD_EXPIRES_AT.getTime() - 1),
      10,
    );
    expect(notYet).not.toContain(CONFORMANCE_BOOKING_ID);
  });

  it('findExpiredHolds respects the afterId cursor', async () => {
    const { provider } = await makeFixture();
    const now = new Date(CONFORMANCE_HOLD_EXPIRES_AT.getTime() + 1);
    const fromStart = await provider.findExpiredHolds(now, 10);
    expect(fromStart).toContain(CONFORMANCE_BOOKING_ID);

    const afterSelf = await provider.findExpiredHolds(
      now,
      10,
      CONFORMANCE_BOOKING_ID,
    );
    expect(afterSelf).not.toContain(CONFORMANCE_BOOKING_ID);
  });
}
