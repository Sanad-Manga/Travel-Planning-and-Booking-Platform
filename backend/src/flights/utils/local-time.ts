/**
 * Local wall-clock time in an IANA time zone -> UTC instant (FLT-03).
 * Uses the built-in Intl database (no extra dependency), so it follows the same tz data as Node.
 */

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock time shown in `timeZone` at `instant`, expressed as if it were UTC (ms). */
function wallClockAsUtc(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Converts a local date-time (as typed at the airport) to the UTC instant.
 *
 * Returns `null` when the text is not a real calendar date-time, or when that wall-clock time does not
 * exist in the zone (it falls inside a daylight-saving "spring forward" gap).
 * When the time happens twice (the "fall back" hour) the EARLIER instant is returned.
 */
export function localToUtc(local: string, timeZone: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = [
    match[1],
    match[2],
    match[3],
    match[4],
    match[5],
    match[6] ?? '0',
  ].map(Number);

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // Reject 2026-02-30, 25:00 and the like (Date.UTC would silently roll them over).
  const check = new Date(asUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }

  // The zone's offset is constant on each side of a single transition, so the offsets in force a day
  // before and a day after find every instant that shows this wall-clock time.
  const candidates = new Set<number>();
  for (const probe of [asUtc - DAY_MS, asUtc + DAY_MS]) {
    const offset = wallClockAsUtc(probe, timeZone) - probe;
    const instant = asUtc - offset;
    if (wallClockAsUtc(instant, timeZone) === asUtc) candidates.add(instant);
  }
  if (candidates.size === 0) return null;
  return new Date(Math.min(...candidates));
}
