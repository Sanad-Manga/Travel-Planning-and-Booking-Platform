import { describe, expect, it } from 'vitest';
import { formatInZone } from './formatInZone';

const ISO = '2026-11-20T14:30:00.000Z';

describe('formatInZone (GEN-06)', () => {
  it('shows the instant in the given IANA zone', () => {
    expect(formatInZone(ISO, 'Africa/Cairo')).toBe('20 Nov 2026, 16:30');
    expect(formatInZone(ISO, 'Asia/Tokyo')).toBe('20 Nov 2026, 23:30');
    expect(formatInZone(ISO, 'UTC')).toBe('20 Nov 2026, 14:30');
  });

  it('moves the date when the zone is past midnight', () => {
    expect(formatInZone('2026-11-20T23:30:00.000Z', 'Asia/Tokyo')).toBe('21 Nov 2026, 08:30');
  });

  it('can show only the date', () => {
    expect(formatInZone(ISO, 'Africa/Cairo', { dateOnly: true })).toBe('20 Nov 2026');
  });

  it('can append the zone name', () => {
    expect(formatInZone(ISO, 'Asia/Tokyo', { showZone: true })).toContain('GMT+9');
  });

  it('uses 24-hour time at midnight (no "24:00")', () => {
    expect(formatInZone('2026-11-20T22:00:00.000Z', 'Africa/Cairo')).toBe('21 Nov 2026, 00:00');
  });

  it('falls back to UTC and says so for an unknown zone', () => {
    expect(formatInZone(ISO, 'Mars/Olympus')).toBe('20 Nov 2026, 14:30 UTC');
  });

  it('shows a dash for a missing or invalid timestamp', () => {
    expect(formatInZone(null, 'UTC')).toBe('—');
    expect(formatInZone(undefined, 'UTC')).toBe('—');
    expect(formatInZone('', 'UTC')).toBe('—');
    expect(formatInZone('not-a-date', 'UTC')).toBe('—');
  });
});
