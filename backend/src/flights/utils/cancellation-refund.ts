import type { CancellationTier } from '../../payments';

export const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * FLT-26: days remaining until the outbound departure, as the shared refund contract expects.
 * Fractional (not whole days): 3.5 means three and a half days left. The caller checks that the
 * departure is still in the future first, so this is positive.
 */
export function daysBeforeDeparture(departureAt: Date, now: Date): number {
  return (departureAt.getTime() - now.getTime()) / MILLISECONDS_PER_DAY;
}

/**
 * The tier whose percentage the refund is calculated with: the one with the highest threshold
 * that does not exceed the days remaining (`RefundCalculator.compute`'s selection rule). Returns
 * null when no tier applies (cancelling too close to departure, or no tiers set), which means a
 * zero refund. The amount itself is always computed by `RefundCalculator`, never here.
 */
export function selectCancellationTier(
  tiers: readonly CancellationTier[],
  daysBefore: number,
): CancellationTier | null {
  const applicable = tiers.filter(
    (tier) => tier.daysBeforeThreshold <= daysBefore,
  );
  if (applicable.length === 0) return null;
  return applicable.reduce((best, tier) =>
    tier.daysBeforeThreshold > best.daysBeforeThreshold ? tier : best,
  );
}
