import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccountStatus, BookingType, Role } from '../common';
import { AccountDeactivationService } from './account-deactivation.service';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { UpcomingBookingsChecker, UpcomingBookingsRegistry } from './upcoming-bookings';
import { UsersService } from './users.service';

const NOW = new Date('2026-11-13T10:00:00.000Z');
const answer = (value: boolean | Error): UpcomingBookingsChecker => ({
  hasUpcomingConfirmedBookings: jest.fn(() => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value))),
});

// Unit tests use a test double for UsersService; the real-database proof is in test/account-deactivation.e2e-spec.ts.
describe('AccountDeactivationService (ACC-12)', () => {
  let users: { findById: jest.Mock; deactivate: jest.Mock };
  let registry: UpcomingBookingsRegistry;
  let service: AccountDeactivationService;
  const user = (over: Record<string, unknown> = {}) => ({ id: 'u1', role: Role.USER, status: AccountStatus.ACTIVE, ...over });

  beforeEach(() => {
    users = { findById: jest.fn().mockResolvedValue(user()), deactivate: jest.fn().mockResolvedValue(true) };
    registry = new UpcomingBookingsRegistry();
    service = new AccountDeactivationService(users as unknown as UsersService, registry);
  });

  it('deactivates when nothing blocks (also with no checker registered)', async () => {
    await expect(service.deactivate('u1', NOW)).resolves.toBeUndefined();
    expect(users.deactivate).toHaveBeenCalledWith('u1');
  });

  it('is blocked by an upcoming CONFIRMED flight booking and changes nothing', async () => {
    registry.register(BookingType.FLIGHT, answer(true));
    registry.register(BookingType.HOTEL, answer(false));
    await expect(service.deactivate('u1', NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(users.deactivate).not.toHaveBeenCalled();
  });

  it('is blocked by an upcoming CONFIRMED hotel booking', async () => {
    registry.register(BookingType.FLIGHT, answer(false));
    registry.register(BookingType.HOTEL, answer(true));
    await expect(service.deactivate('u1', NOW)).rejects.toThrow(/upcoming confirmed bookings/i);
    expect(users.deactivate).not.toHaveBeenCalled();
  });

  it('past, cancelled, pending or completed bookings do not block (the owners answer false for them)', async () => {
    const flights = answer(false);
    registry.register(BookingType.FLIGHT, flights);
    await service.deactivate('u1', NOW);
    expect(flights.hasUpcomingConfirmedBookings).toHaveBeenCalledWith('u1', NOW);
    expect(users.deactivate).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a checker errors: nothing is deactivated', async () => {
    registry.register(BookingType.FLIGHT, answer(new Error('db down')));
    await expect(service.deactivate('u1', NOW)).rejects.toThrow('db down');
    expect(users.deactivate).not.toHaveBeenCalled();
  });

  it.each([Role.ADMIN, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])('%s gets 403 and is not touched', async (role) => {
    users.findById.mockResolvedValue(user({ role }));
    await expect(service.deactivate('u1', NOW)).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.deactivate).not.toHaveBeenCalled();
  });

  it.each([AccountStatus.DEACTIVATED, AccountStatus.SUSPENDED])('a %s or unknown account gets 401', async (status) => {
    users.findById.mockResolvedValue(user({ status }));
    await expect(service.deactivate('u1', NOW)).rejects.toBeInstanceOf(UnauthorizedException);
    users.findById.mockResolvedValue(null);
    await expect(service.deactivate('u1', NOW)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('loses the race gracefully: the conditional update matched nothing -> 401', async () => {
    users.deactivate.mockResolvedValue(false);
    await expect(service.deactivate('u1', NOW)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('DeactivateAccountDto', () => {
  const errorsFor = async (body: unknown) => (await validate(plainToInstance(DeactivateAccountDto, body as object))).flatMap((e) => Object.values(e.constraints ?? {}));

  it('accepts only the boolean true', async () => {
    expect(await errorsFor({ confirm: true })).toEqual([]);
  });

  it.each([{}, { confirm: false }, { confirm: 'true' }, { confirm: 1 }, { confirm: null }])('rejects %j with one message', async (body) => {
    expect(await errorsFor(body)).toEqual(['confirm must be true to deactivate your account']);
  });
});
