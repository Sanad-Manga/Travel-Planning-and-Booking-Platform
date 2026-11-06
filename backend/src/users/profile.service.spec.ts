import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, Role } from '../common';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ProfileService } from './profile.service';
import { UsersService } from './users.service';

const ID = '6730a1f2c3d4e5f607182930';

describe('ProfileService (ACC-09)', () => {
  let service: ProfileService;
  const usersService = { findById: jest.fn(), updateProfile: jest.fn() };
  const referenceData = { findCurrencyById: jest.fn() };

  const userDoc = (extra: Record<string, unknown> = {}) => ({
    id: ID,
    name: 'Ali',
    email: 'ali@example.com',
    role: Role.USER,
    status: AccountStatus.ACTIVE,
    preferredCurrency: 'USD',
    consentAcceptedAt: new Date(),
    createdAt: new Date(),
    ...extra,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    usersService.updateProfile.mockImplementation((_id, changes) => Promise.resolve(userDoc(changes)));
    referenceData.findCurrencyById.mockResolvedValue({ code: 'EUR' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: UsersService, useValue: usersService },
        { provide: ReferenceDataService, useValue: referenceData },
      ],
    }).compile();
    service = moduleRef.get(ProfileService);
  });

  const fieldsOf = (error: BadRequestException) => (error.getResponse() as { details: { field: string }[] }).details.map((d) => d.field);

  describe('getProfile', () => {
    it('returns the response DTO without any hash', async () => {
      usersService.findById.mockResolvedValue(userDoc({ phone: '+201001234567' }));
      const result = await service.getProfile(ID);
      expect(result).toMatchObject({ id: ID, email: 'ali@example.com', phone: '+201001234567' });
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });

    it('omits phone when the user has none', async () => {
      usersService.findById.mockResolvedValue(userDoc());
      expect(await service.getProfile(ID)).not.toHaveProperty('phone');
    });

    it('401 when the user no longer exists', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(service.getProfile(ID)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('updateProfile', () => {
    it('saves only the fields that were sent, for the id from the token', async () => {
      await service.updateProfile(ID, { name: 'New Name' });
      expect(usersService.updateProfile).toHaveBeenCalledWith(ID, { name: 'New Name' });
      expect(referenceData.findCurrencyById).not.toHaveBeenCalled();
    });

    it('checks the currency against the reference data and saves all three fields together', async () => {
      const result = await service.updateProfile(ID, { name: 'N', phone: '+201001234567', preferredCurrency: 'EUR' });
      expect(referenceData.findCurrencyById).toHaveBeenCalledWith('EUR');
      expect(usersService.updateProfile).toHaveBeenCalledWith(ID, { name: 'N', phone: '+201001234567', preferredCurrency: 'EUR' });
      expect(result).toMatchObject({ name: 'N', preferredCurrency: 'EUR' });
    });

    it('an unsupported currency is a field-level 400 and NOTHING is saved, even if other fields are valid', async () => {
      referenceData.findCurrencyById.mockResolvedValue(null);
      const error = await service.updateProfile(ID, { name: 'Valid Name', preferredCurrency: 'ZZZ' }).catch((e: BadRequestException) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(fieldsOf(error as BadRequestException)).toEqual(['preferredCurrency']);
      expect(usersService.updateProfile).not.toHaveBeenCalled();
    });

    it('an empty body is a 400 and nothing is saved', async () => {
      const error = await service.updateProfile(ID, {}).catch((e: BadRequestException) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(usersService.updateProfile).not.toHaveBeenCalled();
    });

    it('passes an empty phone through so it is removed', async () => {
      await service.updateProfile(ID, { phone: '' });
      expect(usersService.updateProfile).toHaveBeenCalledWith(ID, { phone: '' });
    });

    it('401 when the user is gone or no longer ACTIVE (the write found nothing)', async () => {
      usersService.updateProfile.mockResolvedValue(null);
      await expect(service.updateProfile(ID, { name: 'X' })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
