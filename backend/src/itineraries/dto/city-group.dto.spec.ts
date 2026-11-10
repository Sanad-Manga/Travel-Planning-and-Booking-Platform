import { groupDaysByCity } from './city-group.dto';
import { ItineraryDayDto } from './itinerary-day.dto';

/** Days numbered from 1 with consecutive dates from 2026-12-20, one city per entry. */
const daysIn = (...cityIds: string[]): ItineraryDayDto[] =>
  cityIds.map((cityId, index) => ({
    id: `day${index + 1}`,
    dayNumber: index + 1,
    date: `2026-12-${20 + index}`,
    cityId,
    notes: '',
  }));

describe('groupDaysByCity (ITN-09)', () => {
  it('returns no groups for an itinerary without days', () => {
    expect(groupDaysByCity([])).toEqual([]);
  });

  it('puts one day in a group of its own, starting and ending on that day', () => {
    expect(groupDaysByCity(daysIn('cairo'))).toEqual([
      {
        cityId: 'cairo',
        fromDayNumber: 1,
        toDayNumber: 1,
        dayCount: 1,
        startDate: '2026-12-20',
        endDate: '2026-12-20',
        subtotalCents: 0,
      },
    ]);
  });

  it('groups consecutive days in the same city with their day count and dates', () => {
    expect(
      groupDaysByCity(daysIn('cairo', 'cairo', 'luxor', 'luxor', 'luxor')),
    ).toEqual([
      {
        cityId: 'cairo',
        fromDayNumber: 1,
        toDayNumber: 2,
        dayCount: 2,
        startDate: '2026-12-20',
        endDate: '2026-12-21',
        subtotalCents: 0,
      },
      {
        cityId: 'luxor',
        fromDayNumber: 3,
        toDayNumber: 5,
        dayCount: 3,
        startDate: '2026-12-22',
        endDate: '2026-12-24',
        subtotalCents: 0,
      },
    ]);
  });

  it('makes three groups for A, B, A: only consecutive days are grouped', () => {
    const groups = groupDaysByCity(daysIn('cairo', 'dubai', 'cairo'));
    expect(groups.map((group) => group.cityId)).toEqual([
      'cairo',
      'dubai',
      'cairo',
    ]);
    expect(groups.map((group) => group.dayCount)).toEqual([1, 1, 1]);
  });

  it('covers every day exactly once, in order, with no gap between groups', () => {
    const days = daysIn('a', 'a', 'b', 'a', 'c', 'c', 'c', 'b');
    const groups = groupDaysByCity(days);

    expect(groups.reduce((sum, group) => sum + group.dayCount, 0)).toBe(
      days.length,
    );
    expect(groups[0].fromDayNumber).toBe(1);
    expect(groups[groups.length - 1].toDayNumber).toBe(days.length);
    groups.slice(1).forEach((group, index) => {
      expect(group.fromDayNumber).toBe(groups[index].toDayNumber + 1);
    });
  });
});
