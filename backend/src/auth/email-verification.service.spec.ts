import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import configuration from '../config/configuration';
import { EMAIL_VERIFICATION_TTL_MS, EmailVerificationService, ResendCooldownException } from './email-verification.service';

const ID = '6730a1f2c3d4e5f607182930';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('EmailVerificationService (ACC-02)', () => {
  const tokens = { updateOne: jest.fn(), findOneAndDelete: jest.fn(), findOne: jest.fn() };
  const users = { markEmailVerified: jest.fn(), isEmailVerifiedActive: jest.fn(), findById: jest.fn() };
  const email = { send: jest.fn() };
  let service: EmailVerificationService;
  const exec = <T>(value: T) => ({ exec: () => Promise.resolve(value) });

  beforeEach(() => {
    jest.resetAllMocks();
    tokens.updateOne.mockReturnValue(exec({}));
    email.send.mockResolvedValue(undefined);
    service = new EmailVerificationService(tokens as never, users as never, email as never, new ConfigService({ publicApiUrl: 'https://api.example.com/' }));
  });

  const fieldError = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: BadRequestException) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  };

  it('stores only the SHA-256 hash of the token, with a 24 hour expiry', async () => {
    const now = new Date('2026-11-18T10:00:00.000Z');
    const token = (await service.issue(ID, now))!;
    const [filter, update, options] = tokens.updateOne.mock.calls[0];
    expect(filter.userId).toEqual(new Types.ObjectId(ID));
    // Only an old enough row (cutoff 60 s before now) or a row without requestedAt matches; anything else hits the unique userId.
    expect(filter.$or).toEqual([{ requestedAt: { $lte: new Date('2026-11-18T09:59:00.000Z') } }, { requestedAt: { $exists: false } }]);
    expect(update.$set.requestedAt).toEqual(now);
    expect(update.$set.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(update)).not.toContain(token);
    expect(update.$set.expiresAt.getTime() - now.getTime()).toBe(EMAIL_VERIFICATION_TTL_MS);
    expect(EMAIL_VERIFICATION_TTL_MS).toBe(24 * 3600 * 1000);
    expect(options).toEqual({ upsert: true });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes as base64url
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const unverified = { id: ID, name: 'Ali', email: 'ali@example.com', emailVerified: false };
  const duplicateKey = () => ({ exec: () => Promise.reject(Object.assign(new Error('dup'), { code: 11000 })) });

  it('registration email: a link to the API verify route built from the publicApiUrl setting', async () => {
    service.sendInBackground(unverified as never);
    await settle();
    const sent = email.send.mock.calls[0][0];
    expect(sent.to).toBe('ali@example.com');
    expect(sent.text).toMatch(/https:\/\/api\.example\.com\/api\/auth\/verify-email\?token=[A-Za-z0-9_-]{43}/);
  });

  it('the setting comes from the shared configuration: default http://localhost:3001, PUBLIC_API_URL overrides', () => {
    const saved = process.env.PUBLIC_API_URL;
    try {
      delete process.env.PUBLIC_API_URL;
      expect(configuration().publicApiUrl).toBe('http://localhost:3001');
      process.env.PUBLIC_API_URL = 'https://api.example.org';
      expect(configuration().publicApiUrl).toBe('https://api.example.org');
    } finally {
      if (saved === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = saved;
    }
  });

  describe('resend', () => {
    it('creates a NEW token (one conditional upsert on the same userId row, so the old link dies) and emails it', async () => {
      users.findById.mockResolvedValue(unverified);
      await expect(service.resend(ID)).resolves.toEqual({ message: 'Verification email sent' });
      await settle();
      expect(tokens.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update, options] = tokens.updateOne.mock.calls[0];
      expect(filter.userId).toEqual(new Types.ObjectId(ID));
      expect(options).toEqual({ upsert: true });
      const link = /token=([A-Za-z0-9_-]{43})/.exec(email.send.mock.calls[0][0].text)![1];
      expect(update.$set.tokenHash).toBe(sha256(link));
    });

    it.each([
      ['verified', { ...unverified, emailVerified: true }],
      ['legacy (field missing)', { id: ID, name: 'Ali', email: 'ali@example.com' }],
    ])('already verified (%s): 200, nothing stored, nothing sent', async (_label, user) => {
      users.findById.mockResolvedValue(user);
      await expect(service.resend(ID)).resolves.toEqual({ message: 'Email already verified' });
      expect(tokens.updateOne).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('inside the cooldown: 429 with the seconds left, nothing sent', async () => {
      users.findById.mockResolvedValue(unverified);
      tokens.updateOne.mockReturnValue(duplicateKey());
      const now = 1_800_000_000_000; // fixed clock: no drift under load
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
      tokens.findOne.mockReturnValue({ lean: () => exec({ requestedAt: new Date(now - 20_000) }) });
      const error = await service.resend(ID).catch((e: ResendCooldownException) => e);
      clock.mockRestore();
      expect(error).toBeInstanceOf(ResendCooldownException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as ResendCooldownException).retryAfterSeconds).toBe(40);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('a failed send does not change the response', async () => {
      users.findById.mockResolvedValue(unverified);
      email.send.mockRejectedValue(new Error('smtp down'));
      await expect(service.resend(ID)).resolves.toEqual({ message: 'Verification email sent' });
      await settle();
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('an unknown user is a 401', async () => {
      users.findById.mockResolvedValue(null);
      await expect(service.resend(ID)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('verify consumes the token by its hash and marks the user verified', async () => {
    tokens.findOneAndDelete.mockReturnValue(exec({ userId: { toString: () => ID } }));
    users.markEmailVerified.mockResolvedValue(true);
    const now = new Date();
    await expect(service.verify('raw-token', now)).resolves.toEqual({ message: 'Email verified' });
    expect(tokens.findOneAndDelete).toHaveBeenCalledWith({ tokenHash: sha256('raw-token'), expiresAt: { $gt: now } });
    expect(users.markEmailVerified).toHaveBeenCalledWith(ID);
  });

  it('an unknown, expired or already used token (nothing deleted) gives the same field-level 400', async () => {
    tokens.findOneAndDelete.mockReturnValue(exec(null));
    expect(await fieldError(service.verify('nope'))).toMatchObject({
      details: [{ field: 'token', message: 'invalid or expired verification link' }],
    });
    expect(users.markEmailVerified).not.toHaveBeenCalled();
  });

  it('an already verified user with a fresh token gets a clean answer, not an error', async () => {
    tokens.findOneAndDelete.mockReturnValue(exec({ userId: { toString: () => ID } }));
    users.markEmailVerified.mockResolvedValue(false);
    users.isEmailVerifiedActive.mockResolvedValue(true);
    await expect(service.verify('t')).resolves.toEqual({ message: 'Email already verified' });
  });

  it('a user that is not ACTIVE (nothing updated, not verified) gets the generic 400', async () => {
    tokens.findOneAndDelete.mockReturnValue(exec({ userId: { toString: () => ID } }));
    users.markEmailVerified.mockResolvedValue(false);
    users.isEmailVerifiedActive.mockResolvedValue(false);
    await fieldError(service.verify('t'));
  });

  it('a failed email send never throws out of the background helper', async () => {
    email.send.mockRejectedValue(new Error('smtp down'));
    expect(() => service.sendInBackground(unverified as never)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve)); // let the swallowed rejection settle
    expect(email.send).toHaveBeenCalledTimes(1);
  });
});
