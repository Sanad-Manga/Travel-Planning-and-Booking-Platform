import { Model, Types } from 'mongoose';
import { BookingType, Role } from '../common';
import { FlightBooking } from '../flights/schemas/flight-booking.schema';
import { AdminAnalyticsService } from './admin-analytics.service';

describe('AdminAnalyticsService', () => {
  const admin = { userId: 'admin', role: Role.ADMIN };
  const period = { dateFrom: '2026-11-01', dateTo: '2026-11-30' };
  const exec = jest.fn();
  const aggregate = jest.fn(() => ({ allowDiskUse: () => ({ exec }) }));
  const model = (name: string) => ({ collection: { name } }) as never;
  const service = new AdminAnalyticsService(
    { aggregate } as unknown as Model<FlightBooking>,
    model('hotelBookings'),
    model('airlines'),
    model('hotels'),
    model('refunds'),
  );

  beforeEach(() => {
    aggregate.mockClear();
    exec.mockReset();
  });

  it('checks internal callers before querying MongoDB', async () => {
    await expect(
      service.summarize({ ...admin, userId: '' }, period),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.summarize({ ...admin, role: Role.USER }, period),
    ).rejects.toMatchObject({ status: 403 });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it.each([
    { dateFrom: '2026-02-30' },
    { dateTo: '2026-11-01T01:00' },
    { dateFrom: '2026-12-01' },
    { dateTo: undefined },
    { unexpected: true },
  ])(
    'validates the entire reporting query before aggregation (%j)',
    async (invalid) => {
      await expect(
        service.summarize(admin, { ...period, ...invalid } as typeof period),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          details: expect.arrayContaining([
            expect.objectContaining({ field: expect.any(String) }),
          ]),
        },
      });
      expect(aggregate).not.toHaveBeenCalled();
    },
  );

  it('returns a complete zero report for an empty period', async () => {
    exec.mockResolvedValue([]);
    await expect(service.summarize(admin, period)).resolves.toEqual({
      period,
      summary: {
        totalBookings: 0,
        flightBookings: 0,
        hotelBookings: 0,
        confirmedBookings: 0,
      },
      providers: [],
    });
  });

  it('returns exact, safe cents and omits aggregation-only fields', async () => {
    exec.mockResolvedValue([
      {
        type: BookingType.FLIGHT,
        providerId: '650000000000000000000001',
        providerName: null,
        bookingCount: 5,
        confirmedBookingCount: 1,
        invalidAmounts: 0,
        revenueByCurrency: [
          {
            currency: 'EGP',
            revenueCents: Types.Decimal128.fromString('9007199254740991'),
          },
        ],
      },
    ]);
    const report = await service.summarize(admin, period);
    expect(report.summary).toEqual({
      totalBookings: 5,
      flightBookings: 5,
      hotelBookings: 0,
      confirmedBookings: 1,
    });
    expect(report.providers).toEqual([
      {
        type: BookingType.FLIGHT,
        providerId: '650000000000000000000001',
        providerName: null,
        bookingCount: 5,
        confirmedBookingCount: 1,
        revenueByCurrency: [
          { currency: 'EGP', revenueCents: Number.MAX_SAFE_INTEGER },
        ],
      },
    ]);
  });

  it('sanitizes MongoDB failures', async () => {
    exec.mockRejectedValue(new Error('fixture-private-database-diagnostic'));
    await expect(service.summarize(admin, period)).rejects.toMatchObject({
      status: 500,
      message: 'Analytics could not be retrieved',
    });
  });
});
