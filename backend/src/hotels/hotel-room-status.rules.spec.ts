import {
  inclusiveDays,
  listDates,
  nextDay,
  RoomBlockedReason,
  RoomDateStatus,
  RoomDayInput,
  roomStatusForDates,
} from './hotel-room-status.rules';

const base = (over: Partial<RoomDayInput> = {}): RoomDayInput => ({
  isActive: true,
  availability: [{ startDate: '2027-03-01', endDate: '2027-03-31' }],
  blockedRanges: [],
  reservations: [],
  ...over,
});
const reservation = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  reference: 'HTL-AAAA',
  status: 'CONFIRMED',
  checkIn: '2027-03-12',
  checkOut: '2027-03-15',
  ...over,
});

describe('date helpers', () => {
  it('lists every date of the range, both ends included, across a month and a leap day', () => {
    expect(listDates('2027-03-30', '2027-04-02')).toEqual(['2027-03-30', '2027-03-31', '2027-04-01', '2027-04-02']);
    expect(listDates('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
    expect(listDates('2027-03-10', '2027-03-10')).toEqual(['2027-03-10']);
  });

  it('counts inclusive days and finds the next day', () => {
    expect(inclusiveDays('2027-03-10', '2027-03-10')).toBe(1);
    expect(inclusiveDays('2027-03-10', '2027-03-16')).toBe(7);
    expect(inclusiveDays('2027-03-10', '2027-03-09')).toBe(0);
    expect(nextDay('2027-12-31')).toBe('2028-01-01');
  });
});

describe('roomStatusForDates', () => {
  const dates = listDates('2027-03-10', '2027-03-16');
  const statuses = (input: RoomDayInput) => roomStatusForDates(input, dates).map((d) => d.status);

  it('returns exactly one entry and one status per date, in order', () => {
    const days = roomStatusForDates(base({ reservations: [reservation()], blockedRanges: [{ startDate: '2027-03-13', endDate: '2027-03-17' }] }), dates);
    expect(days.map((d) => d.date)).toEqual(dates);
    expect(new Set(days.map((d) => d.date)).size).toBe(dates.length);
    for (const d of days) expect(Object.values(RoomDateStatus)).toContain(d.status);
  });

  it('is AVAILABLE when active, offered, not blocked and not reserved', () => {
    expect(statuses(base())).toEqual(Array(7).fill(RoomDateStatus.AVAILABLE));
  });

  it('is BOOKED on the nights of a stay with its reference; the check-out day is not booked', () => {
    const days = roomStatusForDates(base({ reservations: [reservation()] }), dates);
    expect(days.map((d) => d.status)).toEqual(['AVAILABLE', 'AVAILABLE', 'BOOKED', 'BOOKED', 'BOOKED', 'AVAILABLE', 'AVAILABLE']);
    expect(days[2].reservation).toMatchObject({ id: 'r1', reference: 'HTL-AAAA', status: 'CONFIRMED' });
    expect(days[5].reservation).toBeUndefined();
  });

  it('is BLOCKED inside a blocked range (half-open), with the reason', () => {
    const days = roomStatusForDates(base({ blockedRanges: [{ startDate: '2027-03-11', endDate: '2027-03-13' }] }), dates);
    expect(days.map((d) => d.status)).toEqual(['AVAILABLE', 'BLOCKED', 'BLOCKED', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
    expect(days[1].blockedReason).toBe(RoomBlockedReason.BLOCKED_RANGE);
  });

  it('is BLOCKED (NOT_OFFERED) on dates no availability range covers, including the range end day', () => {
    const days = roomStatusForDates(base({ availability: [{ startDate: '2027-03-11', endDate: '2027-03-14' }] }), dates);
    expect(days.map((d) => d.status)).toEqual(['BLOCKED', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'BLOCKED', 'BLOCKED', 'BLOCKED']);
    expect(days[4].blockedReason).toBe(RoomBlockedReason.NOT_OFFERED);
  });

  it('is BLOCKED (ROOM_DEACTIVATED) on every unbooked date of an inactive room', () => {
    const days = roomStatusForDates(base({ isActive: false }), dates);
    expect(days.every((d) => d.status === RoomDateStatus.BLOCKED && d.blockedReason === RoomBlockedReason.ROOM_DEACTIVATED)).toBe(true);
  });

  it('BOOKED wins over BLOCKED: an existing stay is not hidden by a later block or by a deactivation', () => {
    const blocked = roomStatusForDates(
      base({ isActive: false, blockedRanges: [{ startDate: '2027-03-01', endDate: '2027-03-31' }], reservations: [reservation()] }),
      dates,
    );
    expect(blocked.map((d) => d.status)).toEqual(['BLOCKED', 'BLOCKED', 'BOOKED', 'BOOKED', 'BOOKED', 'BLOCKED', 'BLOCKED']);
  });

  it('a stay that began before the range still marks the first dates; a hold has a null reference', () => {
    const days = roomStatusForDates(
      base({ reservations: [reservation({ checkIn: '2027-03-08', checkOut: '2027-03-12', reference: null, status: 'PENDING_PAYMENT' })] }),
      dates,
    );
    expect(days.slice(0, 2).map((d) => d.status)).toEqual(['BOOKED', 'BOOKED']);
    expect(days[0].reservation).toMatchObject({ reference: null, status: 'PENDING_PAYMENT' });
    expect(days[2].status).toBe('AVAILABLE');
  });

  it('back-to-back stays each show their own reference', () => {
    const days = roomStatusForDates(
      base({
        reservations: [
          reservation({ id: 'a', reference: 'HTL-A', checkIn: '2027-03-10', checkOut: '2027-03-12' }),
          reservation({ id: 'b', reference: 'HTL-B', checkIn: '2027-03-12', checkOut: '2027-03-14' }),
        ],
      }),
      dates,
    );
    expect(days.slice(0, 4).map((d) => d.reservation?.reference)).toEqual(['HTL-A', 'HTL-A', 'HTL-B', 'HTL-B']);
  });
});
