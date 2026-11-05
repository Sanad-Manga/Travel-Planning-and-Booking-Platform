import { localToUtc } from './local-time';

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('localToUtc', () => {
  it.each([
    // zone, local, expected UTC
    ['Africa/Cairo', '2026-12-01T14:30', '2026-12-01T12:30:00.000Z'], // UTC+2 in winter
    ['America/New_York', '2026-12-01T19:45', '2026-12-02T00:45:00.000Z'], // UTC-5 in winter
    ['America/New_York', '2026-07-01T12:00', '2026-07-01T16:00:00.000Z'], // UTC-4 in summer
    ['Europe/London', '2026-07-01T12:00', '2026-07-01T11:00:00.000Z'], // UTC+1 in summer
    ['Asia/Kolkata', '2026-12-01T10:00', '2026-12-01T04:30:00.000Z'], // half-hour offset
    ['Asia/Tokyo', '2026-12-01T00:00', '2026-11-30T15:00:00.000Z'], // crosses midnight
    ['UTC', '2026-12-01T10:15:30', '2026-12-01T10:15:30.000Z'], // seconds accepted
  ])('%s %s -> %s', (zone, local, expected) => {
    expect(iso(localToUtc(local, zone))).toBe(expected);
  });

  it('gives different UTC instants for the same local text in two zones', () => {
    const cairo = localToUtc('2026-12-01T12:00', 'Africa/Cairo');
    const newYork = localToUtc('2026-12-01T12:00', 'America/New_York');
    expect(newYork!.getTime() - cairo!.getTime()).toBe(7 * 60 * 60 * 1000);
  });

  it('returns null for a time skipped by the spring-forward gap', () => {
    expect(localToUtc('2026-03-08T02:30', 'America/New_York')).toBeNull();
    expect(localToUtc('2026-03-29T01:30', 'Europe/London')).toBeNull();
  });

  it('picks the earlier instant when a time happens twice (fall back)', () => {
    // 2026-11-01 01:30 in New York is both 05:30Z (EDT) and 06:30Z (EST).
    expect(iso(localToUtc('2026-11-01T01:30', 'America/New_York'))).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it.each([
    '2026-02-30T10:00', // no such day
    '2026-13-01T10:00',
    '2026-12-01T25:00',
    '2026-12-01T10:60',
    '2026-12-01',
    '2026-12-01T10:00Z', // an offset means it is not local time
    '2026-12-01T10:00+02:00',
    'tomorrow',
    '',
  ])('returns null for %p', (text) => {
    expect(localToUtc(text, 'Africa/Cairo')).toBeNull();
  });
});
