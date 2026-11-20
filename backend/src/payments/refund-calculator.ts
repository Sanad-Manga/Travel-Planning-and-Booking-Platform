import { isValidCents } from './money/money.util';

/**
 * One row of a cancellation policy, owned by the airline (FLT-09) or hotel (HTL-10)
 * module and read here only through their exported getters — Payments never stores
 * or edits tier data (docs/contracts.md section 7).
 */
export interface CancellationTier {
  /** Days-before-departure/check-in at or after which this tier's percentage applies. */
  daysBeforeThreshold: number;
  /** Refund percentage for this tier, 0-100 inclusive. */
  refundPercent: number;
}

export interface RefundCalculatorInput {
  /** The owner's cancellation tiers, in any order. */
  tiers: readonly CancellationTier[];
  /** Days remaining between "now" and the booked departure/check-in. May be fractional. */
  daysBefore: number;
  /** The booking's total price, in integer cents (platform currency). */
  totalCents: number;
}

/**
 * Shared refund-percentage/amount calculator (SCRUM-123), used by both flight and
 * hotel cancellation so the selection rule only lives in one place.
 *
 * Selection rule: of the tiers whose `daysBeforeThreshold` does not exceed
 * `daysBefore`, pick the one with the highest threshold (the tightest bound the
 * cancellation still clears). If no tier qualifies (cancelling too close to the
 * booked date, or no tiers at all), the refund is 0.
 */
export class RefundCalculator {
  /**
   * Returns the refund amount in integer cents.
   *
   * Rounding rule: `totalCents * refundPercent / 100`, rounded to the nearest cent
   * with `Math.round` (ties round half up, e.g. 50.5 -> 51) — the same integer-cents
   * contract `toMoney` enforces elsewhere in Payments.
   *
   * Throws `RangeError` if `totalCents` is not a valid cents value (a bug in the
   * caller, not bad user input) or if `daysBefore` is not a finite number.
   */
  static compute({ tiers, daysBefore, totalCents }: RefundCalculatorInput): number {
    if (!isValidCents(totalCents)) {
      throw new RangeError(`totalCents must be a non-negative integer, got ${totalCents}`);
    }
    if (typeof daysBefore !== 'number' || !Number.isFinite(daysBefore)) {
      throw new RangeError(`daysBefore must be a finite number, got ${daysBefore}`);
    }

    const applicable = tiers.filter((tier) => tier.daysBeforeThreshold <= daysBefore);
    if (applicable.length === 0) {
      return 0;
    }

    // Highest threshold among the applicable tiers. If two tiers share that
    // threshold (owners are expected to keep thresholds unique), the one
    // encountered first wins — ownership of de-duplication stays with FLT-09/HTL-10.
    const chosen = applicable.reduce((best, tier) =>
      tier.daysBeforeThreshold > best.daysBeforeThreshold ? tier : best,
    );

    return Math.round((totalCents * chosen.refundPercent) / 100);
  }
}
