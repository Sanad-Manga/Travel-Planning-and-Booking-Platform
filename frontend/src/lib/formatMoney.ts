const FALLBACK = '—';

/** The backend counts every currency as 100 minor units per unit (docs/contracts.md section 3, `FxService.convert`), whatever the currency's real decimals are. */
const MINOR_PER_UNIT = 100;

/**
 * GEN-06: shows an amount the backend sends as integer minor units (`...Cents` plus a `currency` code).
 * `formatMoney(12345, 'USD')` is "$123.45"; `formatMoney(500, 'JPY')` is "¥500". Never pass a float amount.
 * A missing or non-integer amount gives "—" instead of "NaN"; an unknown currency code gives "123.45 XYZ".
 */
export function formatMoney(cents: number | null | undefined, currency: string, locale = 'en-US'): string {
  if (cents === null || cents === undefined || !Number.isInteger(cents)) return FALLBACK;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / MINOR_PER_UNIT);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
