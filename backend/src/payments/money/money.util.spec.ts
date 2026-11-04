import { BadRequestException } from '@nestjs/common';
import { PLATFORM_CURRENCY } from '../../common/constants';
import { assertPlatformCurrency, formatMoney, isValidCents, toMoney } from './money.util';

describe('assertPlatformCurrency', () => {
  it('does not throw for the platform currency', () => {
    expect(() => assertPlatformCurrency(PLATFORM_CURRENCY)).not.toThrow();
  });

  it('throws BadRequestException for any other currency', () => {
    expect(() => assertPlatformCurrency('EUR')).toThrow(BadRequestException);
  });

  it('includes the given context label in the error message', () => {
    expect(() => assertPlatformCurrency('EUR', 'booking payable amount')).toThrow(
      /booking payable amount/,
    );
  });
});

describe('isValidCents', () => {
  it('accepts zero and positive integers', () => {
    expect(isValidCents(0)).toBe(true);
    expect(isValidCents(1999)).toBe(true);
  });

  it('rejects negative numbers', () => {
    expect(isValidCents(-1)).toBe(false);
  });

  it('rejects non-integers (floats)', () => {
    expect(isValidCents(19.99)).toBe(false);
  });

  it('rejects non-numbers', () => {
    expect(isValidCents('1999')).toBe(false);
    expect(isValidCents(null)).toBe(false);
    expect(isValidCents(undefined)).toBe(false);
  });
});

describe('toMoney', () => {
  it('builds a MoneyDto with the platform currency', () => {
    const money = toMoney(1999);
    expect(money.amountCents).toBe(1999);
    expect(money.currency).toBe(PLATFORM_CURRENCY);
  });

  it('throws for a negative amount', () => {
    expect(() => toMoney(-1)).toThrow(BadRequestException);
  });

  it('throws for a non-integer amount', () => {
    expect(() => toMoney(19.99)).toThrow(BadRequestException);
  });
});

describe('formatMoney', () => {
  it('formats cents as major units with two decimal places', () => {
    expect(formatMoney(1999)).toBe(`19.99 ${PLATFORM_CURRENCY}`);
    expect(formatMoney(100)).toBe(`1.00 ${PLATFORM_CURRENCY}`);
    expect(formatMoney(5)).toBe(`0.05 ${PLATFORM_CURRENCY}`);
  });

  it('accepts an explicit currency override for display purposes', () => {
    expect(formatMoney(1999, 'EUR')).toBe('19.99 EUR');
  });
});
