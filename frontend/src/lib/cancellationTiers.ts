/** Same limits as the backend (`AIRLINE_MAX_*` and `HOTEL_MAX_*` are equal): 20 tiers, up to 365 days. */
export const MAX_TIERS = 20;
export const MAX_TIER_DAYS = 365;

/** One refund tier as the API stores it. `daysBeforeThreshold` is unique within a provider. */
export interface CancellationTier {
  daysBeforeThreshold: number;
  refundPercent: number;
}

/** What the person typed, one row of the form. */
export interface TierRowInput {
  days: string;
  percent: string;
}

export interface TierRowErrors {
  days?: string;
  percent?: string;
}

export interface TierParseResult {
  /** Tiers sorted from the largest threshold to the smallest (the order the API returns). Empty when `errors` has entries. */
  tiers: CancellationTier[];
  /** For each row (same order as the input), `sorted[i]` is the index that row has in `tiers`. */
  order: number[];
  /** Errors by input row index. */
  errors: Record<number, TierRowErrors>;
  /** A problem with the list as a whole, not one row. */
  listError?: string;
}

const WHOLE_NUMBER = /^\d{1,9}$/;

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Checks the typed rows with the backend's rules (whole numbers, days 0-365, percent 0-100, no two rows with
 * the same days, at most 20 rows) so a mistake is shown next to its field before anything is sent.
 * An empty list is valid: it means nothing is refunded.
 */
export function parseTierRows(rows: readonly TierRowInput[]): TierParseResult {
  const errors: Record<number, TierRowErrors> = {};
  const parsed: Array<{ row: number; days: number; percent: number }> = [];
  const setError = (row: number, field: keyof TierRowErrors, message: string) => {
    errors[row] = { ...errors[row], [field]: message };
  };

  rows.forEach((input, row) => {
    const days = wholeNumber(input.days);
    const percent = wholeNumber(input.percent);
    if (input.days.trim() === '') setError(row, 'days', 'Enter the number of days.');
    else if (days === null) setError(row, 'days', 'Use a whole number, like 7.');
    else if (days > MAX_TIER_DAYS) setError(row, 'days', `Use ${MAX_TIER_DAYS} days or fewer.`);

    if (input.percent.trim() === '') setError(row, 'percent', 'Enter the refund percentage.');
    else if (percent === null) setError(row, 'percent', 'Use a whole number from 0 to 100.');
    else if (percent > 100) setError(row, 'percent', 'Use a number from 0 to 100.');

    if (!errors[row] && days !== null && percent !== null) parsed.push({ row, days, percent });
  });

  const firstRowWithDays = new Map<number, number>();
  for (const entry of parsed) {
    const first = firstRowWithDays.get(entry.days);
    if (first === undefined) firstRowWithDays.set(entry.days, entry.row);
    else setError(entry.row, 'days', `Row ${first + 1} already uses ${entry.days} days. Each tier needs its own number of days.`);
  }

  const listError = rows.length > MAX_TIERS ? `Use at most ${MAX_TIERS} tiers.` : undefined;
  if (Object.keys(errors).length > 0 || listError) return { tiers: [], order: [], errors, listError };

  const sorted = [...parsed].sort((a, b) => b.days - a.days);
  const order = new Array<number>(rows.length);
  sorted.forEach((entry, index) => {
    order[entry.row] = index;
  });
  return {
    tiers: sorted.map(({ days, percent }) => ({ daysBeforeThreshold: days, refundPercent: percent })),
    order,
    errors,
  };
}

/** "7 or more days before departure: 50% refund". `event` is "departure" for flights and "check-in" for hotels. */
export function describeTier(tier: CancellationTier, event: string): string {
  const when =
    tier.daysBeforeThreshold === 0
      ? `Any other cancellation before ${event}`
      : `Cancelling ${tier.daysBeforeThreshold} ${tier.daysBeforeThreshold === 1 ? 'day' : 'days'} or more before ${event}`;
  return `${when}: ${tier.refundPercent}% refund`;
}
