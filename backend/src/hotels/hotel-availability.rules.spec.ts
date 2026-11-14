import { cheapestNightlyCombination, coversStay, nightsBetween, stayTotalCents, todayUtc } from './hotel-availability.rules';

describe('hotel search rules (HTL-11)', () => {
  describe('nightsBetween', () => {
    it('counts nights, the check-out day is not a night', () => {
      expect(nightsBetween('2027-03-10', '2027-03-11')).toBe(1);
      expect(nightsBetween('2027-03-10', '2027-03-13')).toBe(3);
    });
    it('works across month and year ends and leap days', () => {
      expect(nightsBetween('2027-12-30', '2028-01-02')).toBe(3);
      expect(nightsBetween('2028-02-28', '2028-03-01')).toBe(2);
    });
  });

  describe('todayUtc', () => {
    it('is the UTC calendar date, not the local one', () => {
      expect(todayUtc(new Date('2027-01-01T23:59:59.000Z'))).toBe('2027-01-01');
      expect(todayUtc(new Date('2027-01-02T00:00:00.000Z'))).toBe('2027-01-02');
    });
  });

  describe('coversStay (half-open ranges [start, end))', () => {
    const r = (startDate: string, endDate: string) => ({ startDate, endDate });

    it('is true when one range covers every night', () => {
      expect(coversStay([r('2027-03-01', '2027-03-31')], '2027-03-10', '2027-03-13')).toBe(true);
    });
    it('is true when the range ends exactly on the check-out day (that day is not a night)', () => {
      expect(coversStay([r('2027-03-10', '2027-03-13')], '2027-03-10', '2027-03-13')).toBe(true);
    });
    it('is false when the range ends the day before check-out (last night missing)', () => {
      expect(coversStay([r('2027-03-10', '2027-03-12')], '2027-03-10', '2027-03-13')).toBe(false);
    });
    it('is false when the first night is missing', () => {
      expect(coversStay([r('2027-03-11', '2027-03-20')], '2027-03-10', '2027-03-13')).toBe(false);
    });
    it('treats adjacent ranges as one', () => {
      expect(coversStay([r('2027-03-12', '2027-03-20'), r('2027-03-01', '2027-03-12')], '2027-03-10', '2027-03-15')).toBe(true);
    });
    it('is false when there is a one-night gap between ranges', () => {
      expect(coversStay([r('2027-03-01', '2027-03-11'), r('2027-03-12', '2027-03-20')], '2027-03-10', '2027-03-15')).toBe(false);
    });
    it('is false without ranges', () => {
      expect(coversStay([], '2027-03-10', '2027-03-13')).toBe(false);
    });
  });

  describe('cheapestNightlyCombination', () => {
    const room = (maxOccupancy: number, pricePerNightCents: number) => ({ maxOccupancy, pricePerNightCents });

    it('is null with fewer free rooms than requested', () => {
      expect(cheapestNightlyCombination([room(2, 100)], 2, 1)).toBeNull();
    });
    it('is the cheapest room for one room that fits', () => {
      expect(cheapestNightlyCombination([room(2, 300), room(2, 100), room(4, 200)], 1, 2)).toBe(100);
    });
    it('skips a cheap room that is too small', () => {
      expect(cheapestNightlyCombination([room(2, 100), room(4, 500)], 1, 3)).toBe(500);
    });
    it('sums the occupancy of several rooms', () => {
      expect(cheapestNightlyCombination([room(2, 100), room(2, 150)], 2, 4)).toBe(250);
    });
    it('is null when the combined occupancy is not enough', () => {
      expect(cheapestNightlyCombination([room(2, 100), room(2, 150)], 2, 5)).toBeNull();
    });
    it('is exact: a cheap big room plus a cheap small room beats two mid rooms', () => {
      const free = [room(4, 100), room(1, 10), room(3, 400), room(3, 400)];
      expect(cheapestNightlyCombination(free, 2, 5)).toBe(110);
    });
    it('uses exactly the requested number of rooms (never fewer)', () => {
      // One room of 10 would already fit 4 guests, but 2 rooms were asked for.
      expect(cheapestNightlyCombination([room(10, 100), room(1, 50)], 2, 4)).toBe(150);
    });
  });
});

describe('stayTotalCents (HTL-15)', () => {
  it('is nights x price per night, in integer cents', () => {
    expect(stayTotalCents(8_500, 3)).toBe(25_500);
    expect(stayTotalCents(8_500, 1)).toBe(8_500);
  });
  it('stays an integer for a long stay at an odd price', () => {
    const total = stayTotalCents(9_999, 60);
    expect(Number.isInteger(total)).toBe(true);
    expect(total).toBe(599_940);
  });
  it('matches the nights counted from the dates', () => {
    expect(stayTotalCents(10_000, nightsBetween('2027-03-10', '2027-03-14'))).toBe(40_000);
  });
});
