const FALLBACK = '—';

/** How many decimal digits the currency has (USD 2, JPY 0, KWD 3), so 1 minor unit is always divided correctly. */
function minorDigits(currency: string, locale: string): number {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/**
 * GEN-06: shows an amount the backend sends as integer minor units (`...Cents` plus a `currency` code).
 * `formatMoney(12345, 'USD')` is "$123.45"; `formatMoney(500, 'JPY')` is "¥500". Never pass a float amount.
 * A missing or non-integer amount gives "—" instead of "NaN"; an unknown currency code gives "123.45 XYZ".
 */
export function formatMoney(cents: number | null | undefined, currency: string, locale = 'en-US'): string {
  if (cents === null || cents === undefined || !Number.isInteger(cents)) return FALLBACK;
  try {
    const digits = minorDigits(currency, locale);
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 10 ** digits);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
