import { BadRequestException } from '@nestjs/common';
import { PLATFORM_CURRENCY } from '../../common/constants';
import { MoneyDto } from './money.dto';

/**
 * Throws if `currency` is not the platform currency. Use this at the
 * boundary of any service in my module that receives a currency from
 * somewhere else (a booking provider's `getPayable()`, a Stripe object,
 * a value read off another module's document) — per PAY-04, booking
 * prices are never FX-converted, so a mismatch here is a bug upstream,
 * not something to coerce.
 *
 * @param context short label for the error message, e.g. "booking payable amount"
 */
export function assertPlatformCurrency(currency: string, context = 'amount'): void {
  if (currency !== PLATFORM_CURRENCY) {
    throw new BadRequestException(
      `${context} currency "${currency}" does not match the platform currency (${PLATFORM_CURRENCY})`,
    );
  }
}

/** True if `value` is a non-negative integer, i.e. a legal `...Cents` value. */
export function isValidCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Builds a `MoneyDto` for an amount already known to be in platform
 * currency, after validating it is a legal cents value. Throws
 * `BadRequestException` rather than silently truncating a float, since a
 * non-integer amount means a caller computed money in major units
 * (dollars) instead of minor units (cents) somewhere upstream.
 */
export function toMoney(amountCents: number): MoneyDto {
  if (!isValidCents(amountCents)) {
    throw new BadRequestException(
      `amountCents must be a non-negative integer, got ${amountCents}`,
    );
  }
  const money = new MoneyDto();
  money.amountCents = amountCents;
  money.currency = PLATFORM_CURRENCY;
  return money;
}

/** Formats a cents amount in the platform currency for display in logs/notifications, e.g. 1999 -> "19.99 USD". */
export function formatMoney(amountCents: number, currency: string = PLATFORM_CURRENCY): string {
  const major = (amountCents / 100).toFixed(2);
  return `${major} ${currency}`;
}
