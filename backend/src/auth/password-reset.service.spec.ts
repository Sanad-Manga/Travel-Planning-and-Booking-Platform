import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { AccountStatus } from '../common';
import { EmailService } from '../email';
import { UsersService } from '../users/users.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetToken } from './schemas/password-reset-token.schema';

const USER_ID = '6730a1f2c3d4e5f607182930';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const exec = <T>(value: T) => ({ exec: () => Promise.resolve(value), lean: () => ({ exec: () => Promise.resolve(value) }) });

describe('PasswordResetService (ACC-07)', () => {
  let service: PasswordResetService;
  const users = { findByEmail: jest.fn(), findByIdWithPassword: jest.fn(), completeEmailPasswordReset: jest.fn() };
  const email = { send: jest.fn() };
  const tokens = { findOneAndUpdate: jest.fn(), findOne: jest.fn() };
  const activeUser = (extra: Record<string, unknown> = {}) => ({
    id: USER_ID,
    email: 'ali@example.com',
    status: AccountStatus.ACTIVE,
    passwordHash: 'old-hash',
    ...extra,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    email.send.mockResolvedValue(undefined);
    tokens.findOneAndUpdate.mockReturnValue(exec(null));
    const moduleRef = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: UsersService, useValue: users },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: new ConfigService({ frontendUrl: 'https://app.example.com/' }) },
        { provide: getModelToken(PasswordResetToken.name), useValue: tokens },
      ],
    }).compile();
    service = moduleRef.get(PasswordResetService);
  });

  afterEach(() => jest.restoreAllMocks());

  const request = async (address = 'ali@example.com') => {
    service.requestReset(address);
    await service.whenIdle();
  };
  const sentLink = (): string => /https?:\/\/\S+/.exec(email.send.mock.calls[0][0].text)![0];

  describe('requestReset', () => {
    it('returns at once (void) and does the work in the background', async () => {
      users.findByEmail.mockResolvedValue(activeUser());
      expect(service.requestReset('ali@example.com')).toBeUndefined();
      expect(email.send).not.toHaveBeenCalled(); // not awaited by the caller
      await service.whenIdle();
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('stores only the SHA-256 hash of the token, never the token', async () => {
      users.findByEmail.mockResolvedValue(activeUser());
      await request();

      const token = new URL(sentLink()).searchParams.get('token')!;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
      const [filter, update] = tokens.findOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ userId: new Types.ObjectId(USER_ID) });
      expect(update.$set.tokenHash).toBe(sha256(token));
      expect(JSON.stringify(tokens.findOneAndUpdate.mock.calls)).not.toContain(token);
    });

    it('expires 30 minutes after creation and the email says so', async () => {
      users.findByEmail.mockResolvedValue(activeUser());
      const before = Date.now();
      await request();
      const expiresAt: Date = tokens.findOneAndUpdate.mock.calls[0][1].$set.expiresAt;
      expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(30 * 60_000);
      expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
      expect(email.send.mock.calls[0][0].text).toContain('30 minutes');
      expect(email.send.mock.calls[0][0].html).toContain('30 minutes');
    });

    it('builds the link from FRONTEND_URL (no double slash) with the token as a query parameter', async () => {
      users.findByEmail.mockResolvedValue(activeUser());
      await request();
      expect(sentLink()).toMatch(/^https:\/\/app\.example\.com\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
    });

    it('a newer request supersedes the older one: ONE upsert on userId overwriting the hash and clearing usedAt', async () => {
      users.findByEmail.mockResolvedValue(activeUser());
      await request();
      await request();
      const calls = tokens.findOneAndUpdate.mock.calls;
      expect(calls).toHaveLength(2);
      for (const [filter, update, options] of calls) {
        expect(filter).toEqual({ userId: new Types.ObjectId(USER_ID) }); // the same single row per user
        expect(options).toEqual({ upsert: true });
        expect(update.$unset).toEqual({ usedAt: 1 });
      }
      expect(calls[0][1].$set.tokenHash).not.toBe(calls[1][1].$set.tokenHash);
    });

    it('retries once when two parallel first requests collide on the unique userId', async () => {
      users.findByEmail.mockResolvedValue(activeUser());
      tokens.findOneAndUpdate.mockReturnValueOnce({ exec: () => Promise.reject(Object.assign(new Error('dup'), { code: 11000 })) });
      tokens.findOneAndUpdate.mockReturnValueOnce(exec(null));
      await request();
      expect(tokens.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['unknown', null],
      ['suspended', activeUser({ status: AccountStatus.SUSPENDED })],
      ['deactivated', activeUser({ status: AccountStatus.DEACTIVATED })],
    ])('%s account: no token, no email', async (_label, user) => {
      users.findByEmail.mockResolvedValue(user);
      await request();
      expect(tokens.findOneAndUpdate).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('a failed email send is swallowed and logged with the user id only (never token, link or address)', async () => {
      users.findByEmail.mockResolvedValue(activeUser());
      email.send.mockRejectedValue(new Error('550 mailbox ali@example.com not found'));
      await expect(request()).resolves.toBeUndefined();

      const logged = (Logger.prototype.error as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain(USER_ID);
      expect(logged).not.toContain('ali@example.com');
      expect(logged).not.toMatch(/token=|reset-password/);
    });

    it('a database failure is swallowed too', async () => {
      users.findByEmail.mockRejectedValue(new Error('db down'));
      await expect(request()).resolves.toBeUndefined();
    });
  });

  describe('reset', () => {
    const dto = { token: 'some-token', newPassword: 'N3wPassw0rd' };
    const row = { userId: new Types.ObjectId(USER_ID), tokenHash: sha256('some-token') };
    const tokenError = {
      message: 'Validation failed',
      details: [{ field: 'token', message: 'token is invalid or has expired' }],
    };

    beforeEach(() => {
      tokens.findOne.mockReturnValue(exec(row));
      users.findByIdWithPassword.mockResolvedValue(activeUser());
      tokens.findOneAndUpdate.mockReturnValue(exec(row));
      users.completeEmailPasswordReset.mockResolvedValue(true);
    });

    it('looks the token up by its hash, consumes it with one compare-and-set, then writes a bcrypt hash', async () => {
      await service.reset(dto);

      expect(tokens.findOne.mock.calls[0][0]).toMatchObject({ tokenHash: sha256('some-token'), usedAt: { $exists: false } });
      const [filter, update] = tokens.findOneAndUpdate.mock.calls[0];
      expect(filter).toMatchObject({ tokenHash: sha256('some-token'), usedAt: { $exists: false } });
      expect(filter.expiresAt.$gt).toBeInstanceOf(Date);
      expect(update.$set.usedAt).toBeInstanceOf(Date);
      const [id, expectedHash, newHash] = users.completeEmailPasswordReset.mock.calls[0];
      expect([id, expectedHash]).toEqual([USER_ID, 'old-hash']);
      expect(newHash).toMatch(/^\$2[aby]\$10\$/);
      expect(newHash).not.toContain(dto.newPassword);
    });

    it.each([
      ['unknown, expired, used or replaced token', () => tokens.findOne.mockReturnValue(exec(null))],
      ['the token was consumed by a parallel request', () => tokens.findOneAndUpdate.mockReturnValue(exec(null))],
      ['the user no longer exists', () => users.findByIdWithPassword.mockResolvedValue(null)],
      ['the user is suspended', () => users.findByIdWithPassword.mockResolvedValue(activeUser({ status: AccountStatus.SUSPENDED }))],
      ['the user is deactivated', () => users.findByIdWithPassword.mockResolvedValue(activeUser({ status: AccountStatus.DEACTIVATED }))],
      ['the password changed meanwhile', () => users.completeEmailPasswordReset.mockResolvedValue(false)],
    ])('%s: the same 400 on token', async (_label, arrange) => {
      arrange();
      const error = await service.reset(dto).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(tokenError);
    });

    it('an inactive user consumes nothing', async () => {
      users.findByIdWithPassword.mockResolvedValue(activeUser({ status: AccountStatus.SUSPENDED }));
      await service.reset(dto).catch(() => undefined);
      expect(tokens.findOneAndUpdate).not.toHaveBeenCalled();
      expect(users.completeEmailPasswordReset).not.toHaveBeenCalled();
    });
  });
});
