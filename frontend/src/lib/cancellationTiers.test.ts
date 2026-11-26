import { describe, expect, it } from 'vitest';
import { MAX_TIERS, describeTier, parseTierRows } from './cancellationTiers';

const row = (days: string, percent: string) => ({ days, percent });

describe('parseTierRows (FLT-09 / HTL-10)', () => {
  it('accepts an empty list: nothing is refunded', () => {
    expect(parseTierRows([])).toEqual({ tiers: [], order: [], errors: {} });
  });

  it('sorts the tiers largest threshold first and maps each row to its place', () => {
    const result = parseTierRows([row('0', '0'), row('14', '100'), row('7', '50')]);
    expect(result.tiers).toEqual([
      { daysBeforeThreshold: 14, refundPercent: 100 },
      { daysBeforeThreshold: 7, refundPercent: 50 },
      { daysBeforeThreshold: 0, refundPercent: 0 },
    ]);
    expect(result.order).toEqual([2, 0, 1]);
  });

  it('accepts the limits: 0 and 365 days, 0 and 100 percent, spaces around the number', () => {
    const result = parseTierRows([row(' 365 ', '100'), row('0', ' 0 ')]);
    expect(result.errors).toEqual({});
    expect(result.tiers).toHaveLength(2);
  });

  it.each([
    ['', 'Enter the number of days.'],
    ['   ', 'Enter the number of days.'],
    ['7.5', 'Use a whole number, like 7.'],
    ['-1', 'Use a whole number, like 7.'],
    ['1e2', 'Use a whole number, like 7.'],
    ['abc', 'Use a whole number, like 7.'],
    ['366', 'Use 365 days or fewer.'],
  ])('rejects days %j', (days, message) => {
    const result = parseTierRows([row(days, '50')]);
    expect(result.errors[0]).toEqual({ days: message });
    expect(result.tiers).toEqual([]);
  });

  it.each([
    ['', 'Enter the refund percentage.'],
    ['50%', 'Use a whole number from 0 to 100.'],
    ['12.5', 'Use a whole number from 0 to 100.'],
    ['101', 'Use a number from 0 to 100.'],
  ])('rejects percent %j', (percent, message) => {
    expect(parseTierRows([row('7', percent)]).errors[0]).toEqual({ percent: message });
  });

  it('reports both fields of one row, and several rows, at once', () => {
    const result = parseTierRows([row('x', 'y'), row('7', '50'), row('', '10')]);
    expect(Object.keys(result.errors)).toEqual(['0', '2']);
    expect(result.errors[0]).toEqual({ days: 'Use a whole number, like 7.', percent: 'Use a whole number from 0 to 100.' });
  });

  it('flags a second row that repeats the days, naming the first row', () => {
    const result = parseTierRows([row('7', '50'), row('14', '100'), row('7', '20')]);
    expect(result.errors).toEqual({ 2: { days: 'Row 1 already uses 7 days. Each tier needs its own number of days.' } });
    expect(result.tiers).toEqual([]);
  });

  it('treats "07" and "7" as the same number of days', () => {
    const result = parseTierRows([row('7', '50'), row('07', '20')]);
    expect(result.errors[1]?.days).toContain('Row 1 already uses 7 days');
  });

  it('allows exactly the maximum number of tiers and rejects one more', () => {
    const rows = (count: number) => Array.from({ length: count }, (_, index) => row(String(index), '10'));
    expect(parseTierRows(rows(MAX_TIERS)).errors).toEqual({});
    expect(parseTierRows(rows(MAX_TIERS + 1)).listError).toBe(`Use at most ${MAX_TIERS} tiers.`);
  });

  it('allows a refund that grows closer to the date (the server decides, this only checks the format)', () => {
    expect(parseTierRows([row('14', '10'), row('0', '90')]).errors).toEqual({});
  });
});

describe('describeTier', () => {
  it('says what the tier means in words', () => {
    expect(describeTier({ daysBeforeThreshold: 7, refundPercent: 50 }, 'departure')).toBe('Cancelling 7 days or more before departure: 50% refund');
    expect(describeTier({ daysBeforeThreshold: 1, refundPercent: 20 }, 'check-in')).toBe('Cancelling 1 day or more before check-in: 20% refund');
    expect(describeTier({ daysBeforeThreshold: 0, refundPercent: 0 }, 'departure')).toBe('Any other cancellation before departure: 0% refund');
  });
});
