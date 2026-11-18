import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HotelDetailsQueryDto } from './dto/hotel-details-query.dto';
import { HotelDetailsService } from './hotel-details.service';

const ID = '6730a1f2c3d4e5f607182930';

const hotelDoc = {
  _id: { toString: () => ID },
  name: 'Nile View Hotel',
  address: '12 Corniche El Nil',
  cityId: 'CAI',
  countryCode: 'EG',
  description: 'A hotel on the Nile.',
  photos: [{ id: 'p1', url: '/uploads/p1.jpg' }],
  starRating: 4,
  amenities: ['wifi'],
};
const policies = { hotelId: ID, checkInTime: '14:00', checkOutTime: '11:00', cancellationTiers: [] };
const roomsPage = { items: [], page: 1, limit: 10, total: 0, totalPages: 0 };

function build(found: unknown = hotelDoc) {
  const findOne = jest.fn(() => ({ select: () => ({ lean: async () => found }) }));
  const getPolicies = jest.fn(async () => policies);
  const listFreeRooms = jest.fn(async () => roomsPage);
  const reviewSummary = { averageRating: null, reviewCount: 0, reviews: [] };
  const getSummary = jest.fn(async () => reviewSummary);
  const service = new HotelDetailsService(
    { findOne } as never,
    { getPolicies } as never,
    { listFreeRooms } as never,
    { getSummary } as never,
  );
  return { service, findOne, getPolicies, listFreeRooms, getSummary };
}
const query = (extra: Partial<HotelDetailsQueryDto> = {}): HotelDetailsQueryDto => ({ page: 1, limit: 10, ...extra });

describe('HotelDetailsService (HTL-02)', () => {
  it('only an active hotel is looked up', async () => {
    const { service, findOne } = build();
    await service.getDetails(ID, query());
    expect(findOne).toHaveBeenCalledWith({ _id: ID, isActive: true });
  });

  it('a hotel that is not found (inactive or unknown) is a 404 and nothing else is read', async () => {
    const { service, getPolicies, listFreeRooms } = build(null);
    await expect(service.getDetails(ID, query())).rejects.toBeInstanceOf(NotFoundException);
    expect(getPolicies).not.toHaveBeenCalled();
    expect(listFreeRooms).not.toHaveBeenCalled();
  });

  it('a malformed id is a 404 without a database lookup', async () => {
    const { service, findOne } = build();
    await expect(service.getDetails('not-an-id', query())).rejects.toBeInstanceOf(NotFoundException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('without dates rooms is null and the free-rooms service is not called', async () => {
    const { service, listFreeRooms } = build();
    const res = await service.getDetails(ID, query());
    expect(res.rooms).toBeNull();
    expect(listFreeRooms).not.toHaveBeenCalled();
    expect(res.policies).toBe(policies);
  });

  it('with both dates the HTL-15 service is called with the stay and the paging', async () => {
    const { service, listFreeRooms } = build();
    const res = await service.getDetails(ID, query({ checkIn: '2027-03-10', checkOut: '2027-03-13', page: 2, limit: 5 }));
    expect(listFreeRooms).toHaveBeenCalledWith(ID, { checkIn: '2027-03-10', checkOut: '2027-03-13', page: 2, limit: 5 });
    expect(res.rooms).toBe(roomsPage);
  });

  it.each([
    [{ checkIn: '2027-03-10' }, 'checkOut'],
    [{ checkOut: '2027-03-13' }, 'checkIn'],
  ])('only one date (%j) is a 400 on %s', async (dates, field) => {
    const { service, listFreeRooms } = build();
    const err = await service.getDetails(ID, query(dates)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ details: [{ field }] });
    expect(listFreeRooms).not.toHaveBeenCalled();
  });

  it('loads the review summary from HotelReviewsService', async () => {
    const { service, getSummary } = build();
    expect(await service.getDetails(ID, query())).toMatchObject({ averageRating: null, reviewCount: 0, reviews: [] });
    expect(getSummary).toHaveBeenCalledWith(ID);
  });
});
