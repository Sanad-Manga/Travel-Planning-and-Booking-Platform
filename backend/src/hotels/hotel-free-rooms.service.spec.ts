import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FreeRoom, HotelAvailabilityService } from './hotel-availability.service';
import { HotelFreeRoomsService } from './hotel-free-rooms.service';

const HOTEL = '6730a1f2c3d4e5f607182930';
const NOW = new Date('2027-03-01T10:00:00.000Z');

const free = (n: number): FreeRoom[] =>
  Array.from({ length: n }, (_v, i) => ({
    roomId: `r${i}`,
    hotelId: HOTEL,
    name: `Room ${i}`,
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    pricePerNightCents: 1_000 + i,
  }));

function build(rooms: FreeRoom[], hotelExists = true) {
  const findFreeRooms = jest.fn(async () => rooms);
  const exists = jest.fn(async () => (hotelExists ? { _id: HOTEL } : null));
  const service = new HotelFreeRoomsService({ exists } as never, { findFreeRooms } as unknown as HotelAvailabilityService);
  return { service, findFreeRooms, exists };
}
const query = (extra: object = {}) => ({ checkIn: '2027-03-10', checkOut: '2027-03-13', page: 1, limit: 10, ...extra });

describe('HotelFreeRoomsService (HTL-15)', () => {
  it('asks the shared findFreeRooms for this hotel and dates, and adds nights and totals in integer cents', async () => {
    const { service, findFreeRooms } = build(free(2));
    const page = await service.listFreeRooms(HOTEL, query(), NOW);
    expect(findFreeRooms).toHaveBeenCalledWith([HOTEL], '2027-03-10', '2027-03-13');
    expect(page.items[0]).toEqual({
      roomId: 'r0',
      name: 'Room 0',
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNightCents: 1_000,
      totalCents: 3_000,
      checkIn: '2027-03-10',
      checkOut: '2027-03-13',
      nights: 3,
      currency: 'USD',
    });
    expect(page.items[1].totalCents).toBe(3_003);
  });

  it('keeps the order of findFreeRooms and pages it, a page past the end is empty', async () => {
    const { service } = build(free(25));
    const second = await service.listFreeRooms(HOTEL, query({ page: 2, limit: 10 }), NOW);
    expect(second).toMatchObject({ page: 2, limit: 10, total: 25, totalPages: 3 });
    expect(second.items.map((r) => r.roomId)).toEqual(free(25).slice(10, 20).map((r) => r.roomId));
    const past = await service.listFreeRooms(HOTEL, query({ page: 9 }), NOW);
    expect(past.items).toEqual([]);
    expect(past.total).toBe(25);
  });

  it('no free room is an empty page', async () => {
    const { service } = build([]);
    expect(await service.listFreeRooms(HOTEL, query(), NOW)).toEqual({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 });
  });

  it('rejects checkOut not after checkIn and a past checkIn with one detail per field, before touching the database', async () => {
    const { service, exists } = build(free(1));
    await expect(service.listFreeRooms(HOTEL, query({ checkOut: '2027-03-10' }), NOW)).rejects.toMatchObject({
      response: { details: [{ field: 'checkOut', message: 'checkOut must be after checkIn' }] },
    });
    await expect(service.listFreeRooms(HOTEL, query({ checkIn: '2027-02-28', checkOut: '2027-03-02' }), NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(exists).not.toHaveBeenCalled();
  });

  it('today is a valid check-in', async () => {
    const { service } = build(free(1));
    await expect(service.listFreeRooms(HOTEL, query({ checkIn: '2027-03-01', checkOut: '2027-03-02' }), NOW)).resolves.toBeDefined();
  });

  it('a malformed id and an unknown or inactive hotel are 404', async () => {
    await expect(build(free(1)).service.listFreeRooms('not-an-id', query(), NOW)).rejects.toBeInstanceOf(NotFoundException);
    const missing = build(free(1), false);
    await expect(missing.service.listFreeRooms(HOTEL, query(), NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(missing.findFreeRooms).not.toHaveBeenCalled();
  });
});
