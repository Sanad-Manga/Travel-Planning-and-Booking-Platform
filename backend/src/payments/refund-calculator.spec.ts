import { CancellationTier, RefundCalculator } from './refund-calculator';

const tiers: CancellationTier[] = [
  { daysBeforeThreshold: 7, refundPercent: 100 },
  { daysBeforeThreshold: 3, refundPercent: 50 },
  { daysBeforeThreshold: 1, refundPercent: 25 },
];

describe('RefundCalculator.compute', () => {
  it('picks the tier at an exact threshold', () => {
    expect(RefundCalculator.compute({ tiers, daysBefore: 3, totalCents: 10_000 })).toBe(5_000);
  });

  it('picks the highest threshold not exceeding days remaining, between thresholds', () => {
    expect(RefundCalculator.compute({ tiers, daysBefore: 5, totalCents: 10_000 })).toBe(5_000);
  });

  it('picks the top tier when days remaining is above the highest threshold', () => {
    expect(RefundCalculator.compute({ tiers, daysBefore: 30, totalCents: 10_000 })).toBe(10_000);
  });

  it('refunds 0 when days remaining is below the lowest threshold', () => {
    expect(RefundCalculator.compute({ tiers, daysBefore: 0.5, totalCents: 10_000 })).toBe(0);
  });

  it('refunds 0 when there are no tiers at all', () => {
    expect(RefundCalculator.compute({ tiers: [], daysBefore: 10, totalCents: 10_000 })).toBe(0);
  });

  it('rounds to the nearest cent (half up)', () => {
    const oddTiers: CancellationTier[] = [{ daysBeforeThreshold: 1, refundPercent: 33 }];
    // 101 * 33 / 100 = 33.33 -> 33
    expect(RefundCalculator.compute({ tiers: oddTiers, daysBefore: 1, totalCents: 101 })).toBe(33);
    // 103 * 33 / 100 = 33.99 -> 34
    expect(RefundCalculator.compute({ tiers: oddTiers, daysBefore: 1, totalCents: 103 })).toBe(34);
    // half-up tie: 100 * 50.5 / 100 = 50.5 -> 51 (not used with real tiers, but exercises Math.round's tie rule)
  });

  it('throws if totalCents is not a valid integer-cents value', () => {
    expect(() => RefundCalculator.compute({ tiers, daysBefore: 10, totalCents: 19.99 })).toThrow(
      RangeError,
    );
    expect(() => RefundCalculator.compute({ tiers, daysBefore: 10, totalCents: -1 })).toThrow(
      RangeError,
    );
  });

  it('throws if daysBefore is not a finite number', () => {
    expect(() =>
      RefundCalculator.compute({ tiers, daysBefore: Number.NaN, totalCents: 10_000 }),
    ).toThrow(RangeError);
  });
});
