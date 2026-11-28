import { describe, expect, it } from 'vitest';
import { formatCalendarDate, formatDayCount } from './format';

describe('itinerary formatting (ITN-03)', () => {
  it('shows a calendar date without shifting it into another day', () => {
    expect(formatCalendarDate('2026-12-20')).toBe('20 Dec 2026');
    expect(formatCalendarDate('2027-01-01')).toBe('01 Jan 2027');
  });

  it('counts days in words a person would use', () => {
    expect(formatDayCount(0)).toBe('No days yet');
    expect(formatDayCount(1)).toBe('1 day');
    expect(formatDayCount(5)).toBe('5 days');
  });
});
