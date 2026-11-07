import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthenticatedUser, Role } from '.';
import {
  assertCanViewBooking,
  assertOwner,
  bookingVisibilityFilter,
  canViewBooking,
  isOwner,
} from './ownership';

const id = () => new Types.ObjectId().toHexString();
const OWNER = id();
const AIRLINE = id();
const HOTEL = id();

const user = (extra: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  userId: OWNER,
  role: Role.USER,
  ...extra,
});
const other = (
  role: Role,
  extra: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({ userId: id(), role, ...extra });

const flightBooking = { ownerId: OWNER, airlineId: AIRLINE };
const hotelBooking = { ownerId: OWNER, hotelId: HOTEL };

describe('isOwner / assertOwner', () => {
  it('allows the owner', () => {
    expect(isOwner(user(), { ownerId: OWNER })).toBe(true);
    expect(() =>
      assertOwner(user(), { ownerId: OWNER }, 'Itinerary not found'),
    ).not.toThrow();
  });

  it('rejects another user with a 404 carrying the caller message', () => {
    const stranger = other(Role.USER);
    expect(isOwner(stranger, { ownerId: OWNER })).toBe(false);
    expect(() =>
      assertOwner(stranger, { ownerId: OWNER }, 'Itinerary not found'),
    ).toThrow(NotFoundException);
    expect(() =>
      assertOwner(stranger, { ownerId: OWNER }, 'Itinerary not found'),
    ).toThrow('Itinerary not found');
  });

  it('does NOT allow an admin or a moderator on the owner-only check', () => {
    expect(isOwner(other(Role.ADMIN), { ownerId: OWNER })).toBe(false);
    expect(
      isOwner(other(Role.AIRLINE_MODERATOR, { airlineId: AIRLINE }), {
        ownerId: OWNER,
        airlineId: AIRLINE,
      }),
    ).toBe(false);
  });

  it('compares ObjectId and string ids equally, in both directions', () => {
    expect(isOwner(user(), { ownerId: new Types.ObjectId(OWNER) })).toBe(true);
    expect(
      isOwner(
        {
          userId: new Types.ObjectId(OWNER) as unknown as string,
          role: Role.USER,
        },
        { ownerId: OWNER },
      ),
    ).toBe(true);
  });

  it('never matches undefined, null or empty ids', () => {
    expect(isOwner(user(), {})).toBe(false);
    expect(isOwner(user(), { ownerId: null })).toBe(false);
    expect(isOwner({ userId: '', role: Role.USER }, { ownerId: '' })).toBe(
      false,
    );
    expect(
      isOwner(
        { userId: undefined as unknown as string, role: Role.USER },
        { ownerId: undefined },
      ),
    ).toBe(false);
  });
});

describe('canViewBooking / assertCanViewBooking', () => {
  it('allows the owner (USER role)', () => {
    expect(canViewBooking(user(), flightBooking)).toBe(true);
    expect(() =>
      assertCanViewBooking(user(), hotelBooking, 'Booking not found'),
    ).not.toThrow();
  });

  it('rejects another USER with a 404', () => {
    const stranger = other(Role.USER);
    expect(canViewBooking(stranger, flightBooking)).toBe(false);
    expect(() =>
      assertCanViewBooking(stranger, flightBooking, 'Booking not found'),
    ).toThrow(NotFoundException);
    expect(() =>
      assertCanViewBooking(stranger, flightBooking, 'Booking not found'),
    ).toThrow('Booking not found');
  });

  it('allows any admin on any booking', () => {
    expect(canViewBooking(other(Role.ADMIN), flightBooking)).toBe(true);
    expect(canViewBooking(other(Role.ADMIN), hotelBooking)).toBe(true);
  });

  it('allows the airline moderator of the booking airline, rejects another airline', () => {
    expect(
      canViewBooking(
        other(Role.AIRLINE_MODERATOR, { airlineId: AIRLINE }),
        flightBooking,
      ),
    ).toBe(true);
    expect(
      canViewBooking(
        other(Role.AIRLINE_MODERATOR, { airlineId: id() }),
        flightBooking,
      ),
    ).toBe(false);
  });

  it('allows the hotel moderator of the booking hotel, rejects another hotel', () => {
    expect(
      canViewBooking(
        other(Role.HOTEL_MODERATOR, { hotelId: HOTEL }),
        hotelBooking,
      ),
    ).toBe(true);
    expect(
      canViewBooking(
        other(Role.HOTEL_MODERATOR, { hotelId: id() }),
        hotelBooking,
      ),
    ).toBe(false);
  });

  it('rejects a moderator of the wrong type (airline moderator on a hotel booking and vice versa)', () => {
    expect(
      canViewBooking(
        other(Role.AIRLINE_MODERATOR, { airlineId: AIRLINE }),
        hotelBooking,
      ),
    ).toBe(false);
    expect(
      canViewBooking(
        other(Role.HOTEL_MODERATOR, { hotelId: HOTEL }),
        flightBooking,
      ),
    ).toBe(false);
  });

  it('rejects a moderator with no airlineId / hotelId, even if the booking has none either', () => {
    expect(canViewBooking(other(Role.AIRLINE_MODERATOR), flightBooking)).toBe(
      false,
    );
    expect(canViewBooking(other(Role.HOTEL_MODERATOR), hotelBooking)).toBe(
      false,
    );
    expect(
      canViewBooking(other(Role.AIRLINE_MODERATOR), { ownerId: OWNER }),
    ).toBe(false);
  });

  it('a moderator who is also the owner still sees their own booking', () => {
    expect(
      canViewBooking(user({ role: Role.AIRLINE_MODERATOR }), flightBooking),
    ).toBe(true);
  });

  it('matches ObjectId resource ids against string principal ids', () => {
    const booking = {
      ownerId: new Types.ObjectId(OWNER),
      airlineId: new Types.ObjectId(AIRLINE),
    };
    expect(
      canViewBooking(
        other(Role.AIRLINE_MODERATOR, { airlineId: AIRLINE }),
        booking,
      ),
    ).toBe(true);
  });
});

describe('bookingVisibilityFilter', () => {
  it('USER: only their own bookings', () => {
    expect(bookingVisibilityFilter(user())).toEqual({ userId: OWNER });
  });

  it('ADMIN: everything', () => {
    expect(bookingVisibilityFilter(other(Role.ADMIN))).toEqual({});
  });

  it('AIRLINE_MODERATOR: their airline', () => {
    expect(
      bookingVisibilityFilter(
        other(Role.AIRLINE_MODERATOR, { airlineId: AIRLINE }),
      ),
    ).toEqual({ airlineId: AIRLINE });
  });

  it('HOTEL_MODERATOR: their hotel', () => {
    expect(
      bookingVisibilityFilter(other(Role.HOTEL_MODERATOR, { hotelId: HOTEL })),
    ).toEqual({ hotelId: HOTEL });
  });

  it('field names can be overridden', () => {
    const fields = {
      ownerField: 'customer',
      airlineField: 'carrier',
      hotelField: 'property',
    };
    expect(bookingVisibilityFilter(user(), fields)).toEqual({
      customer: OWNER,
    });
    expect(
      bookingVisibilityFilter(
        other(Role.AIRLINE_MODERATOR, { airlineId: AIRLINE }),
        fields,
      ),
    ).toEqual({ carrier: AIRLINE });
    expect(
      bookingVisibilityFilter(
        other(Role.HOTEL_MODERATOR, { hotelId: HOTEL }),
        fields,
      ),
    ).toEqual({ property: HOTEL });
  });

  it('a moderator without the needed id, or an unknown role, matches nothing', () => {
    const nothing = { _id: { $in: [] } };
    expect(bookingVisibilityFilter(other(Role.AIRLINE_MODERATOR))).toEqual(
      nothing,
    );
    expect(bookingVisibilityFilter(other(Role.HOTEL_MODERATOR))).toEqual(
      nothing,
    );
    expect(
      bookingVisibilityFilter(
        other(Role.AIRLINE_MODERATOR, { hotelId: HOTEL }),
      ),
    ).toEqual(nothing);
    expect(
      bookingVisibilityFilter({ userId: id(), role: 'GHOST' as Role }),
    ).toEqual(nothing);
  });
});
