import type { CancellationTier } from '../../payments';
import {
  daysBeforeDeparture,
  MILLISECONDS_PER_DAY,
  selectCancellationTier,
} from './cancellation-refund';

describe('flight cancellation refund helpers (FLT-26)', () => {
  const now = new Date('2026-11-19T00:00:00.000Z');

  it('uses fractional days between now and the outbound departure', () => {
    const departureAt = new Date(now.getTime() + 7.5 * MILLISECONDS_PER_DAY);

    expect(daysBeforeDeparture(departureAt, now)).toBe(7.5);
  });

  it('selects the highest threshold that the days remaining clear', () => {
    const tiers: CancellationTier[] = [
      { daysBeforeThreshold: 30, refundPercent: 100 },
      { daysBeforeThreshold: 7, refundPercent: 50 },
      { daysBeforeThreshold: 0, refundPercent: 10 },
    ];

    expect(selectCancellationTier(tiers, 30)).toEqual({
      daysBeforeThreshold: 30,
      refundPercent: 100,
    });
    expect(selectCancellationTier(tiers, 29.99)).toEqual({
      daysBeforeThreshold: 7,
      refundPercent: 50,
    });
    // Fractional: 7.5 days still clears the 7-day tier, but 6.999 does not.
    expect(selectCancellationTier(tiers, 7.5)).toEqual({
      daysBeforeThreshold: 7,
      refundPercent: 50,
    });
    expect(selectCancellationTier(tiers, 6.999)).toEqual({
      daysBeforeThreshold: 0,
      refundPercent: 10,
    });
  });

  it('returns null when no tier applies or the airline has no tiers', () => {
    expect(
      selectCancellationTier(
        [{ daysBeforeThreshold: 7, refundPercent: 50 }],
        6.99,
      ),
    ).toBeNull();
    expect(selectCancellationTier([], 100)).toBeNull();
  });
});
