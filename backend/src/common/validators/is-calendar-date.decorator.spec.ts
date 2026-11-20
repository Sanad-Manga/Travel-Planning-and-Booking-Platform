import { isCalendarDate } from './is-calendar-date.decorator';

describe('isCalendarDate', () => {
  it.each(['2026-12-20', '2028-02-29', '2026-01-01', '2026-12-31'])(
    'accepts %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(true);
    },
  );

  it.each([
    '2026-02-30', // no such day
    '2027-02-29', // not a leap year
    '2026-13-01', // no such month
    '2026-00-10',
    '2026-12-00',
    '2026-1-5', // wrong shape
    '20/12/2026',
    '2026-12-20T10:00:00.000Z', // a date-time, not a date
    ' 2026-12-20',
    '',
  ])('rejects %s', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it.each([undefined, null, 20261220, new Date(), {}, ['2026-12-20']])(
    'rejects a non-string (%p)',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );
});
