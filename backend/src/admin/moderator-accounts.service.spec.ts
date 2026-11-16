import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { compare } from 'bcryptjs';
import { Types } from 'mongoose';
import { AccountStatus, AuthenticatedUser, Role } from '../common';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ModeratorAccountsService } from './moderator-accounts.service';

const airlineId = new Types.ObjectId().toString();
const hotelId = new Types.ObjectId().toString();
const admin: AuthenticatedUser = { userId: new Types.ObjectId().toString(), role: Role.ADMIN };
const temporaryPassword = 'Temp0rary9Pass';

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Hala',
  email: 'hala@example.test',
  role: Role.HOTEL_MODERATOR,
  temporaryPassword,
  hotelId,
  ...over,
});
const dtoOf = (over: Record<string, unknown> = {}) => plainToInstance(CreateModeratorDto, body(over));
const errorFields = (over: Record<string, unknown>) =>
  validateSync(dtoOf(over), { whitelist: true, forbidNonWhitelisted: true })
    .map((e) => e.property)
    .sort();

describe('CreateModeratorDto rules (ACC-13)', () => {
  it('accepts both valid shapes and normalizes name and email like registration', () => {
    expect(errorFields({})).toEqual([]);
    expect(errorFields({ role: Role.AIRLINE_MODERATOR, hotelId: undefined, airlineId })).toEqual([]);
    const dto = dtoOf({ name: '  Hala ', email: ' HALA@Example.TEST ' });
    expect([dto.name, dto.email]).toEqual(['Hala', 'hala@example.test']);
  });
  it.each([Role.USER, Role.ADMIN, 'x', undefined])('rejects role %s', (role) => {
    expect(errorFields({ role })).toEqual(['role']);
  });
  it('rejects bad ids, weak passwords and bad name/email, one entry per field', () => {
    expect(errorFields({ hotelId: 'nope' })).toEqual(['hotelId']);
    expect(errorFields({ airlineId: 'nope' })).toEqual(['airlineId']);
    expect(errorFields({ temporaryPassword: 'short1' })).toEqual(['temporaryPassword']);
    expect(errorFields({ temporaryPassword: 'a1' + 'x'.repeat(71) })).toEqual(['temporaryPassword']);
    expect(errorFields({ email: 'nope', name: '' })).toEqual(['email', 'name']);
  });
  it('rejects unknown fields such as status or passwordHash', () => {
    expect(errorFields({ status: 'SUSPENDED', passwordHash: 'x' })).toEqual(['passwordHash', 'status']);
  });
});

describe('ModeratorAccountsService (ACC-13, collaborators are test doubles)', () => {
  let created: Array<Record<string, unknown>>;
  let users: { create: jest.Mock };
  let airlines: { exists: jest.Mock };
  let hotels: { getPolicies: jest.Mock };
  let audit: { log: jest.Mock };
  let service: ModeratorAccountsService;

  beforeEach(() => {
    created = [];
    users = {
      create: jest.fn((doc: Record<string, unknown>) => {
        created.push(doc);
        return Promise.resolve({
          ...doc,
          _id: new Types.ObjectId(),
          id: 'new-id',
          createdAt: new Date('2026-11-16T10:00:00Z'),
        });
      }),
    };
    airlines = { exists: jest.fn().mockResolvedValue(true) };
    hotels = { getPolicies: jest.fn().mockResolvedValue({}) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ModeratorAccountsService(
      users as never,
      airlines as never,
      hotels as never,
      audit as never,
    );
  });

  const run = (over: Record<string, unknown> = {}, actor = admin) => service.create(actor, dtoOf(over));
  const failure = async (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e as { getStatus(): number; getResponse(): Record<string, unknown> });

  it.each([
    ['AIRLINE_MODERATOR', { role: Role.AIRLINE_MODERATOR, hotelId: undefined, airlineId }, 'airlineId', airlineId],
    ['HOTEL_MODERATOR', {}, 'hotelId', hotelId],
  ])('creates a %s linked to exactly one provider with a salted bcrypt hash', async (_label, over, field, id) => {
    const res = await run(over);
    expect(res).toEqual({
      id: expect.any(String),
      name: 'Hala',
      email: 'hala@example.test',
      role: (over as { role?: Role }).role ?? Role.HOTEL_MODERATOR,
      status: AccountStatus.ACTIVE,
      createdAt: '2026-11-16T10:00:00.000Z',
    });
    expect(users.create).toHaveBeenCalledTimes(1);
    const doc = created[0];
    expect((doc[field] as Types.ObjectId).toString()).toBe(id);
    expect(doc[field === 'airlineId' ? 'hotelId' : 'airlineId']).toBeUndefined();
    expect(doc).toMatchObject({ status: AccountStatus.ACTIVE, mustChangePassword: true, temporaryPasswordConsumed: false });
    expect(doc.temporaryPasswordExpiresAt).toBeInstanceOf(Date);
    expect(doc.consentAcceptedAt).toBeInstanceOf(Date);
    expect(String(doc.passwordHash).startsWith('$2b$10$')).toBe(true);
    expect(await compare(temporaryPassword, String(doc.passwordHash))).toBe(true);
    expect(JSON.stringify(doc)).not.toContain(temporaryPassword);
    expect(JSON.stringify(res)).not.toContain(temporaryPassword);
  });

  it('writes one audit entry without the password or hash', async () => {
    await run();
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toEqual({
      actorId: admin.userId,
      action: 'MODERATOR_CREATED',
      targetType: 'User',
      targetId: 'new-id',
      details: { role: Role.HOTEL_MODERATOR, hotelId },
    });
    expect(JSON.stringify(entry)).not.toContain(temporaryPassword);
  });

  it.each([
    ['both ids on a hotel moderator', {}, { airlineId }, ['airlineId']],
    ['both ids on an airline moderator', { role: Role.AIRLINE_MODERATOR, hotelId, airlineId }, {}, ['hotelId']],
    ['no id on a hotel moderator', { hotelId: undefined }, {}, ['hotelId']],
    ['no id on an airline moderator', { role: Role.AIRLINE_MODERATOR, hotelId: undefined }, {}, ['airlineId']],
    ['the wrong kind of id', { hotelId: undefined, airlineId }, {}, ['airlineId', 'hotelId']],
  ])('answers 400 for %s and writes nothing', async (_label, a, b, fields) => {
    const error = await failure(run({ ...a, ...b }));
    expect(error?.getStatus()).toBe(400);
    const details = error!.getResponse().details as Array<{ field: string }>;
    expect(details.map((d) => d.field).sort()).toEqual(fields);
    expect(users.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('answers 404 with a field detail for an unknown airline or hotel', async () => {
    airlines.exists.mockResolvedValue(false);
    const airline = await failure(run({ role: Role.AIRLINE_MODERATOR, hotelId: undefined, airlineId }));
    expect(airline?.getStatus()).toBe(404);
    expect((airline!.getResponse().details as Array<{ field: string }>)[0].field).toBe('airlineId');
    hotels.getPolicies.mockRejectedValue(new NotFoundException('Hotel not found'));
    const hotel = await failure(run());
    expect(hotel?.getStatus()).toBe(404);
    expect((hotel!.getResponse().details as Array<{ field: string }>)[0].field).toBe('hotelId');
    expect(users.create).not.toHaveBeenCalled();
  });

  it('does not hide other failures of the hotel lookup as a 404', async () => {
    hotels.getPolicies.mockRejectedValue(new Error('db down'));
    await expect(run()).rejects.toThrow('db down');
    expect(users.create).not.toHaveBeenCalled();
  });

  it('maps a duplicate-key error to the registration 409 shape', async () => {
    users.create.mockRejectedValue({ code: 11000, keyPattern: { email: 1 } });
    const error = await failure(run());
    expect(error?.getStatus()).toBe(409);
    expect(error!.getResponse()).toEqual({
      message: 'Email already registered',
      details: [{ field: 'email', message: 'email already exists' }],
    });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('hides driver errors behind a sanitized 500', async () => {
    users.create.mockRejectedValue(new Error(`insert failed for ${temporaryPassword}`));
    const error = await failure(run());
    expect(error?.getStatus()).toBe(500);
    expect(JSON.stringify(error!.getResponse())).not.toContain(temporaryPassword);
  });

  it('reports a failed audit after creation without leaking anything and without retrying', async () => {
    audit.log.mockRejectedValue(new Error('audit down'));
    const error = await failure(run());
    expect(error?.getStatus()).toBe(500);
    expect(users.create).toHaveBeenCalledTimes(1);
  });

  it('checks the actor in the service too', async () => {
    expect((await failure(run({}, { userId: '', role: Role.ADMIN })))?.getStatus()).toBe(401);
    for (const role of [Role.USER, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR]) {
      expect((await failure(run({}, { userId: admin.userId, role })))?.getStatus()).toBe(403);
    }
    expect(users.create).not.toHaveBeenCalled();
  });
});
