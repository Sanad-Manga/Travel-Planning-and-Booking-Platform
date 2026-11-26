const FALLBACK = '—';

export interface FormatInZoneOptions {
  /** Show the date only, without the time. */
  dateOnly?: boolean;
  /** Append the zone name, e.g. "GMT+2". Use it where two zones are shown side by side (a flight). */
  showZone?: boolean;
  locale?: string;
}

function build(timeZone: string, { dateOnly, showZone, locale = 'en-GB' }: FormatInZoneOptions) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }),
    ...(showZone && !dateOnly ? { timeZoneName: 'short' as const } : {}),
  });
}

/**
 * GEN-06: shows a UTC ISO timestamp (`2026-11-20T14:30:00.000Z`) in an airport's or hotel's own IANA zone
 * ("Africa/Cairo"), as the contract asks for flight times. An unknown zone falls back to UTC and says so;
 * a missing or invalid timestamp gives "—".
 */
export function formatInZone(iso: string | null | undefined, timeZone: string, options: FormatInZoneOptions = {}): string {
  if (!iso) return FALLBACK;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return FALLBACK;
  try {
    return build(timeZone, options).format(date);
  } catch {
    return `${build('UTC', { ...options, showZone: false }).format(date)} UTC`;
  }
}
