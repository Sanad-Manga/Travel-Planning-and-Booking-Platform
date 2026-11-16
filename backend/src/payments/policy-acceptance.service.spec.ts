import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { BookingType, Role } from '../common';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user';
import { BookingProviderRegistry } from './booking-provider.registry';
import { FakeBookingProvider } from './fake-booking-provider';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import {
  PolicyAcceptance,
  PolicyAcceptanceLean,
} from './schemas/policy-acceptance.schema';

/** Minimal in-memory stand-in for `Model<PolicyAcceptance>` — only the calls the service makes. */
class FakePolicyAcceptanceModel {
  private readonly rows = new Map<string, PolicyAcceptanceLean>();

  private key(
    bookingType: BookingType,
    bookingId: Types.ObjectId,
    userId: Types.ObjectId,
  ): string {
    return `${bookingType}:${bookingId.toString()}:${userId.toString()}`;
  }

  findOneAndUpdate(
    filter: {
      bookingType: BookingType;
      bookingId: Types.ObjectId;
      userId: Types.ObjectId;
    },
    update: { $set: { acceptedAt: Date } },
  ) {
    const key = this.key(filter.bookingType, filter.bookingId, filter.userId);
    const existing = this.rows.get(key);
    const row: PolicyAcceptanceLean = {
      _id: existing?._id ?? new Types.ObjectId(),
      bookingType: filter.bookingType,
      bookingId: filter.bookingId,
      userId: filter.userId,
      acceptedAt: update.$set.acceptedAt,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    return { lean: () => ({ exec: async () => row }) };
  }

  exists(filter: { bookingType: BookingType; bookingId: Types.ObjectId }) {
    const found = [...this.rows.values()].some(
      (row) =>
        row.bookingType === filter.bookingType &&
        row.bookingId.toString() === filter.bookingId.toString(),
    );
    return { exec: async () => (found ? { _id: new Types.ObjectId() } : null) };
  }
}

const OWNER_ID = new Types.ObjectId().toString();
const OTHER_USER_ID = new Types.ObjectId().toString();
const FLIGHT_BOOKING_ID = new Types.ObjectId().toString();
const HOTEL_BOOKING_ID = new Types.ObjectId().toString();
const UNKNOWN_BOOKING_ID = new Types.ObjectId().toString();

function user(userId: string): AuthenticatedUser {
  return { userId, role: Role.USER };
}

describe('PolicyAcceptanceService', () => {
  let flights: FakeBookingProvider;
  let model: FakePolicyAcceptanceModel;

  function makeService(registerHotelProvider: boolean): PolicyAcceptanceService {
    flights = new FakeBookingProvider();
    flights.setPolicies(FLIGHT_BOOKING_ID, {
      ownerId: OWNER_ID,
      cancellationTiers: [{ daysBeforeThreshold: 7, refundPercent: 50 }],
      baggagePolicy: {
        airlineId: 'airline-1',
        extraBagPriceCents: 3000,
        currency: 'USD',
        maxExtraBags: 2,
        extraBagWeightRule: 'rule',
      },
    });

    const registry = new BookingProviderRegistry();
    registry.register(BookingType.FLIGHT, flights);
    if (registerHotelProvider) {
      const hotels = new FakeBookingProvider();
      hotels.setPolicies(HOTEL_BOOKING_ID, {
        ownerId: OWNER_ID,
        cancellationTiers: [{ daysBeforeThreshold: 3, refundPercent: 100 }],
        checkInTime: '14:00',
        checkOutTime: '11:00',
      });
      registry.register(BookingType.HOTEL, hotels);
    }

    model = new FakePolicyAcceptanceModel();
    return new PolicyAcceptanceService(
      registry,
      model as unknown as Model<PolicyAcceptance>,
    );
  }

  describe('getPolicies', () => {
    it('returns tiers and baggage policy for a flight booking the caller owns', async () => {
      const service = makeService(true);
      const result = await service.getPolicies(
        user(OWNER_ID),
        'flight',
        FLIGHT_BOOKING_ID,
      );
      expect(result.bookingType).toBe(BookingType.FLIGHT);
      expect(result.cancellationTiers).toEqual([
        { daysBeforeThreshold: 7, refundPercent: 50 },
      ]);
      expect(result.baggagePolicy?.extraBagPriceCents).toBe(3000);
      expect(result.checkInTime).toBeUndefined();
    });

    it('returns tiers and check-in/out times for a hotel booking the caller owns', async () => {
      const service = makeService(true);
      const result = await service.getPolicies(
        user(OWNER_ID),
        'HOTEL',
        HOTEL_BOOKING_ID,
      );
      expect(result.bookingType).toBe(BookingType.HOTEL);
      expect(result.checkInTime).toBe('14:00');
      expect(result.checkOutTime).toBe('11:00');
      expect(result.baggagePolicy).toBeUndefined();
    });

    it('rejects an unknown :type with 400', async () => {
      const service = makeService(true);
      await expect(
        service.getPolicies(user(OWNER_ID), 'CRUISE', FLIGHT_BOOKING_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns 404 for HOTEL when no hotel provider is registered yet', async () => {
      const service = makeService(false);
      await expect(
        service.getPolicies(user(OWNER_ID), 'HOTEL', HOTEL_BOOKING_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 for an unknown booking', async () => {
      const service = makeService(true);
      await expect(
        service.getPolicies(user(OWNER_ID), 'FLIGHT', UNKNOWN_BOOKING_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 (never 403) when the caller is not the booking owner', async () => {
      const service = makeService(true);
      await expect(
        service.getPolicies(user(OTHER_USER_ID), 'FLIGHT', FLIGHT_BOOKING_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('acceptPolicies', () => {
    it('records the acceptance with the caller as the user and a timestamp', async () => {
      const service = makeService(true);
      const result = await service.acceptPolicies(
        user(OWNER_ID),
        'FLIGHT',
        FLIGHT_BOOKING_ID,
      );
      expect(result.bookingType).toBe(BookingType.FLIGHT);
      expect(result.userId).toBe(OWNER_ID);
      expect(result.acceptedAt).toBeInstanceOf(Date);
    });

    it('is idempotent when accepted twice', async () => {
      const service = makeService(true);
      const first = await service.acceptPolicies(
        user(OWNER_ID),
        'FLIGHT',
        FLIGHT_BOOKING_ID,
      );
      const second = await service.acceptPolicies(
        user(OWNER_ID),
        'FLIGHT',
        FLIGHT_BOOKING_ID,
      );
      expect(second.bookingId).toBe(first.bookingId);
      await expect(
        service.assertAccepted(BookingType.FLIGHT, FLIGHT_BOOKING_ID),
      ).resolves.toBeUndefined();
    });

    it('rejects an unknown :type with 400', async () => {
      const service = makeService(true);
      await expect(
        service.acceptPolicies(user(OWNER_ID), 'CRUISE', FLIGHT_BOOKING_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns 404 when the caller is not the booking owner', async () => {
      const service = makeService(true);
      await expect(
        service.acceptPolicies(user(OTHER_USER_ID), 'FLIGHT', FLIGHT_BOOKING_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertAccepted', () => {
    it('throws ConflictException when nothing has been accepted for the booking', async () => {
      const service = makeService(true);
      await expect(
        service.assertAccepted(BookingType.FLIGHT, FLIGHT_BOOKING_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('resolves once the booking has an acceptance row', async () => {
      const service = makeService(true);
      await service.acceptPolicies(user(OWNER_ID), 'FLIGHT', FLIGHT_BOOKING_ID);
      await expect(
        service.assertAccepted(BookingType.FLIGHT, FLIGHT_BOOKING_ID),
      ).resolves.toBeUndefined();
    });
  });
});
