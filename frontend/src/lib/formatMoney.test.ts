import { describe, expect, it } from 'vitest';
import { formatMoney } from './formatMoney';

describe('formatMoney (GEN-06)', () => {
  it('divides integer cents by 100 for two-digit currencies', () => {
    expect(formatMoney(12345, 'USD')).toBe('$123.45');
    expect(formatMoney(5, 'USD')).toBe('$0.05');
    expect(formatMoney(0, 'USD')).toBe('$0.00');
  });

  it('divides by 100 for every currency, as the backend does; Intl only picks the decimals shown', () => {
    expect(formatMoney(250000, 'USD')).toBe('$2,500.00');
    expect(formatMoney(250000, 'JPY')).toBe('¥2,500');
    expect(formatMoney(250000, 'KWD')).toContain('2,500.000');
  });

  it('formats a negative amount (a refund adjustment)', () => {
    expect(formatMoney(-2500, 'USD')).toBe('-$25.00');
  });

  it('groups thousands', () => {
    expect(formatMoney(123456789, 'USD')).toBe('$1,234,567.89');
  });

  it('shows a dash for a missing or non-integer amount, never NaN', () => {
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney(undefined, 'USD')).toBe('—');
    expect(formatMoney(Number.NaN, 'USD')).toBe('—');
    expect(formatMoney(12.5, 'USD')).toBe('—');
  });

  it('falls back to "amount CODE" for an invalid currency code', () => {
    expect(formatMoney(12345, 'not-a-currency')).toBe('123.45 not-a-currency');
  });
});
