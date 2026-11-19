import { checkInInstant, daysUntil } from './hotel-cancellation.rules';

describe('hotel cancellation rules (HTL-21)', () => {
  describe('checkInInstant', () => {
    it("is the check-in date at the hotel's check-in time, in UTC", () => {
      expect(checkInInstant('2027-03-10', '15:30').toISOString()).toBe('2027-03-10T15:30:00.000Z');
    });

    it('is the start of the check-in day when the hotel never set a check-in time', () => {
      expect(checkInInstant('2027-03-10', null).toISOString()).toBe('2027-03-10T00:00:00.000Z');
    });
  });

  describe('daysUntil', () => {
    const instant = new Date('2027-03-10T12:00:00.000Z');

    it('counts whole and fractional days from now to the instant', () => {
      expect(daysUntil(instant, new Date('2027-03-03T12:00:00.000Z'))).toBe(7);
      expect(daysUntil(instant, new Date('2027-03-09T00:00:00.000Z'))).toBe(1.5);
    });

    it('is zero at the instant and negative after it', () => {
      expect(daysUntil(instant, instant)).toBe(0);
      expect(daysUntil(instant, new Date('2027-03-11T12:00:00.000Z'))).toBe(-1);
    });
  });
});
