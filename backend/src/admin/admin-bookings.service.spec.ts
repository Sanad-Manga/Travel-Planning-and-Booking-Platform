import { Model } from 'mongoose';
import { BookingType, Role } from '../common';
import { FlightBooking } from '../flights/schemas/flight-booking.schema';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminBookingsQueryDto } from './dto/admin-bookings-query.dto';

describe('AdminBookingsService internal callers', () => {
  const admin = { userId: 'fixture-admin', role: Role.ADMIN };
  const query = new AdminBookingsQueryDto();
  const aggregate = jest.fn();
  const service = new AdminBookingsService(
    { aggregate } as unknown as Model<FlightBooking>,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => aggregate.mockReset());

  it('enforces authentication and role before querying', async () => {
    await expect(
      service.list({ ...admin, userId: '' }, query),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.list({ ...admin, role: Role.USER }, query),
    ).rejects.toMatchObject({ status: 403 });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'OTHER' },
    { dateFrom: '2026-11-02', dateTo: '2026-11-01' },
    { page: Number.MAX_SAFE_INTEGER },
    { unexpected: 1 },
  ])('enforces validation before querying for %j', async (invalid) => {
    await expect(
      service.list(admin, { ...query, ...invalid } as AdminBookingsQueryDto),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        details: [expect.objectContaining({ field: expect.any(String) })],
      },
    });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('returns a sanitized failure without attaching the driver error', async () => {
    aggregate.mockReturnValue({
      allowDiskUse: () => ({
        exec: async () => {
          throw new Error('synthetic-driver-diagnostic');
        },
      }),
    });
    await expect(
      service.list(admin, { ...query, type: BookingType.FLIGHT }),
    ).rejects.toMatchObject({
      status: 500,
      message: 'Bookings could not be retrieved',
    });
  });
});
