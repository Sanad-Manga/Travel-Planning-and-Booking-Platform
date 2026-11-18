import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { EMAIL_VERIFICATION_TTL_MS, EmailVerificationService } from './email-verification.service';

const ID = '6730a1f2c3d4e5f607182930';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('EmailVerificationService (ACC-02)', () => {
  const tokens = { updateOne: jest.fn(), findOneAndDelete: jest.fn() };
  const users = { markEmailVerified: jest.fn(), isEmailVerifiedActive: jest.fn() };
  const email = { send: jest.fn() };
  let service: EmailVerificationService;
  const exec = <T>(value: T) => ({ exec: () => Promise.resolve(value) });

  beforeEach(() => {
    jest.resetAllMocks();
    tokens.updateOne.mockReturnValue(exec({}));
    email.send.mockResolvedValue(undefined);
    service = new EmailVerificationService(tokens as never, users as never, email as never, new ConfigService({ PUBLIC_API_URL: 'https://api.example.com/' }));
  });

  const fieldError = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: BadRequestException) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  };

  it('stores only the SHA-256 hash of the token, with a 24 hour expiry', async () => {
    const now = new Date('2026-11-18T10:00:00.000Z');
    const token = await service.issue(ID, now);
    const [filter, update, options] = tokens.updateOne.mock.calls[0];
    expect(filter).toEqual({ userId: ID });
    expect(update.$set.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(update)).not.toContain(token);
    expect(update.$set.expiresAt.getTime() - now.getTime()).toBe(EMAIL_VERIFICATION_TTL_MS);
    expect(EMAIL_VERIFICATION_TTL_MS).toBe(24 * 3600 * 1000);
    expect(options).toEqual({ upsert: true });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes as base64url
  });

  it('emails a link to the API verify route built from PUBLIC_API_URL', async () => {
    await service.issueAndSend({ id: ID, name: 'Ali', email: 'ali@example.com' } as never);
    const sent = email.send.mock.calls[0][0];
    expect(sent.to).toBe('ali@example.com');
    expect(sent.text).toMatch(/https:\/\/api\.example\.com\/api\/auth\/verify-email\?token=[A-Za-z0-9_-]{43}/);
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
    expect(() => service.sendInBackground({ id: ID, name: 'Ali', email: 'ali@example.com' } as never)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve)); // let the swallowed rejection settle
    expect(email.send).toHaveBeenCalledTimes(1);
  });
});
