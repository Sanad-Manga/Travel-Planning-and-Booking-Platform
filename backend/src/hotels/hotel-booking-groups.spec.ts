import { BookingStatus } from '../common';
import {
  groupFilter,
  groupOf,
  HotelBookingGroup,
} from './hotel-booking-groups';

/** Fixed "now": 2026-11-16 12:00 UTC, so today (UTC) is 2026-11-16. */
const NOW = new Date('2026-11-16T12:00:00.000Z');
const LIVE_HOLD = new Date('2026-11-16T12:10:00.000Z');
const LAPSED_HOLD = new Date('2026-11-16T11:50:00.000Z');

describe('hotel reservation groups (HTL-20)', () => {
  describe('groupOf', () => {
    it.each([
      [
        'a confirmed stay that has not started',
        BookingStatus.CONFIRMED,
        '2026-11-20',
        undefined,
        HotelBookingGroup.UPCOMING,
      ],
      [
        'a confirmed stay that ends tomorrow (the guest is still there)',
        BookingStatus.CONFIRMED,
        '2026-11-17',
        undefined,
        HotelBookingGroup.UPCOMING,
      ],
      [
        'a confirmed stay that ends today (check-out day is not a night)',
        BookingStatus.CONFIRMED,
        '2026-11-16',
        undefined,
        HotelBookingGroup.PAST,
      ],
      [
        'a confirmed stay that ended last week',
        BookingStatus.CONFIRMED,
        '2026-11-09',
        undefined,
        HotelBookingGroup.PAST,
      ],
      [
        'a completed stay',
        BookingStatus.COMPLETED,
        '2026-11-01',
        undefined,
        HotelBookingGroup.PAST,
      ],
      [
        'a cancelled reservation',
        BookingStatus.CANCELLED,
        '2026-12-01',
        undefined,
        HotelBookingGroup.CANCELLED,
      ],
      [
        'an expired reservation',
        BookingStatus.EXPIRED,
        '2026-12-01',
        undefined,
        HotelBookingGroup.CANCELLED,
      ],
      [
        'a reservation waiting for payment with a live hold',
        BookingStatus.PENDING_PAYMENT,
        '2026-12-01',
        LIVE_HOLD,
        HotelBookingGroup.UPCOMING,
      ],
      [
        'a reservation waiting for payment whose hold has lapsed',
        BookingStatus.PENDING_PAYMENT,
        '2026-12-01',
        LAPSED_HOLD,
        HotelBookingGroup.CANCELLED,
      ],
      [
        'a pending reservation with no hold date',
        BookingStatus.PENDING_PAYMENT,
        '2026-12-01',
        undefined,
        HotelBookingGroup.CANCELLED,
      ],
    ])(
      'puts %s in its group',
      (_label, status, checkOut, holdExpiresAt, expected) => {
        expect(groupOf({ status, checkOut, holdExpiresAt }, NOW)).toBe(
          expected,
        );
      },
    );

    it('treats a hold that ends exactly now as lapsed', () => {
      expect(
        groupOf(
          {
            status: BookingStatus.PENDING_PAYMENT,
            checkOut: '2026-12-01',
            holdExpiresAt: NOW,
          },
          NOW,
        ),
      ).toBe(HotelBookingGroup.CANCELLED);
    });
  });

  describe('groupFilter', () => {
    it('asks for confirmed stays that are not over and live holds when UPCOMING', () => {
      expect(groupFilter(HotelBookingGroup.UPCOMING, NOW)).toEqual({
        $or: [
          { status: BookingStatus.CONFIRMED, checkOut: { $gt: '2026-11-16' } },
          {
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $gt: NOW },
          },
        ],
      });
    });

    it('asks for completed stays and confirmed stays that are over when PAST', () => {
      expect(groupFilter(HotelBookingGroup.PAST, NOW)).toEqual({
        $or: [
          { status: BookingStatus.COMPLETED },
          { status: BookingStatus.CONFIRMED, checkOut: { $lte: '2026-11-16' } },
        ],
      });
    });

    it('asks for cancelled, expired and lapsed holds when CANCELLED', () => {
      expect(groupFilter(HotelBookingGroup.CANCELLED, NOW)).toEqual({
        $or: [
          { status: { $in: [BookingStatus.CANCELLED, BookingStatus.EXPIRED] } },
          {
            status: BookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $not: { $gt: NOW } },
          },
        ],
      });
    });
  });
});
