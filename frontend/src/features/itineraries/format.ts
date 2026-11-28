import { formatInZone } from '@/lib/formatInZone';

/** An itinerary date (`YYYY-MM-DD`, no time zone) as "20 Dec 2026". Read in UTC so it never shifts a day. */
export function formatCalendarDate(date: string): string {
  return formatInZone(`${date}T00:00:00.000Z`, 'UTC', { dateOnly: true });
}

export function formatDayCount(count: number): string {
  if (count === 0) return 'No days yet';
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}
