import { InternalServerErrorException } from '@nestjs/common';
import { compare, getRounds, hash } from 'bcryptjs';
import { validateSync } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { BCRYPT_SALT_ROUNDS } from '../auth/auth.service';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { createValidationPipe } from '../common';
import {
  AdminPasswordResetBodyDto,
  AdminPasswordResetParamsDto,
} from './dto/admin-password-reset.dto';
import { TemporaryPasswordService } from './temporary-password.service';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));
jest.mock('node:crypto', () => {
  const actual =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, randomBytes: jest.fn(actual.randomBytes) };
});
jest.mock('bcryptjs', () => {
  const actual = jest.requireActual<typeof import('bcryptjs')>('bcryptjs');
  return { ...actual, hash: jest.fn(actual.hash) };
});

describe('ACC-07a independent temporary credential preparation (no reset endpoint)', () => {
  const service = new TemporaryPasswordService();
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('uses 24 cryptographic random bytes and produces a credential accepted by the existing password rules', async () => {
    const generated = await service.generate();
    expect(randomBytes).toHaveBeenCalledWith(24);
    const dto = Object.assign(new ChangePasswordDto(), {
      currentPassword: generated.temporaryPassword,
      newPassword: generated.temporaryPassword,
    });
    expect(
      validateSync(dto, { validationError: { target: false, value: false } })
        .length === 0,
    ).toBe(true);
    expect(generated.temporaryPassword.length === 34).toBe(true);
    expect(
      await compare(generated.temporaryPassword, generated.passwordHash),
    ).toBe(true);
    expect(getRounds(generated.passwordHash)).toBe(BCRYPT_SALT_ROUNDS);
    expect(generated.passwordHash.includes(generated.temporaryPassword)).toBe(
      false,
    );
  });
  it('sets expiration exactly 24 hours after generation, before hashing finishes', async () => {
    const generatedAt = Date.UTC(2026, 10, 13, 10);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(generatedAt);
    jest.mocked(hash).mockImplementationOnce((() => {
      clock.mockReturnValue(generatedAt + 5000);
      return Promise.resolve('synthetic-hash');
    }) as typeof hash);
    try {
      const generated = await service.generate();
      expect(generated.expiresAt.toISOString()).toBe(
        '2026-11-14T10:00:00.000Z',
      );
    } finally {
      clock.mockRestore();
    }
  });
  it('uses a fresh bcrypt salt even if the random input is held identical in the test', async () => {
    jest
      .mocked(randomBytes)
      .mockReturnValueOnce(Buffer.alloc(24) as never)
      .mockReturnValueOnce(Buffer.alloc(24) as never);
    const first = await service.generate();
    const second = await service.generate();
    expect(first.temporaryPassword === second.temporaryPassword).toBe(true);
    expect(first.passwordHash === second.passwordHash).toBe(false);
    expect(await compare(second.temporaryPassword, first.passwordHash)).toBe(
      true,
    );
    expect(await compare(first.temporaryPassword, second.passwordHash)).toBe(
      true,
    );
  });
  it('does not repeat generated credentials in a small smoke sample', async () => {
    const values = await Promise.all(
      Array.from({ length: 4 }, () => service.generate()),
    );
    expect(new Set(values.map((value) => value.temporaryPassword)).size).toBe(
      4,
    );
  });
  it('returns a sanitized error on a random-source failure', async () => {
    jest.mocked(randomBytes).mockImplementationOnce(() => {
      throw new Error('synthetic-private-random-diagnostic');
    });
    const error = await service.generate().catch((value: unknown) => value);
    expect(error instanceof InternalServerErrorException).toBe(true);
    expect((error as Error).message).toBe(
      'Temporary credential generation failed',
    );
    expect(
      (error as Error).stack?.includes('synthetic-private-random-diagnostic'),
    ).toBe(false);
    expect(hash).not.toHaveBeenCalled();
  });
  it('does not echo a generated credential or cause when hashing fails', async () => {
    const diagnostic = 'synthetic-private-hash-diagnostic';
    jest.mocked(hash).mockRejectedValueOnce(new Error(diagnostic) as never);
    const error = await service.generate().catch((value: unknown) => value);
    expect((error as Error).message).toBe(
      'Temporary credential generation failed',
    );
    expect((error as Error).stack?.includes(diagnostic)).toBe(false);
    expect((error as Error).cause).toBeUndefined();
  });
  it('accepts a valid target ID and rejects invalid target IDs using existing validation', async () => {
    const pipe = createValidationPipe();
    await expect(
      pipe.transform(
        { id: '673000000000000000000001' },
        { type: 'param', metatype: AdminPasswordResetParamsDto },
      ),
    ).resolves.toBeInstanceOf(AdminPasswordResetParamsDto);
    await expect(
      pipe.transform(
        { id: 'not-an-id' },
        { type: 'param', metatype: AdminPasswordResetParamsDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects unsupported reset-body fields without including supplied values', async () => {
    const pipe = createValidationPipe();
    for (const body of [
      { password: 'synthetic-do-not-echo' },
      { role: 'ADMIN' },
      { status: 'ACTIVE' },
      { id: 'other' },
    ]) {
      const error = await pipe
        .transform(body, { type: 'body', metatype: AdminPasswordResetBodyDto })
        .catch((value: unknown) => value);
      expect((error as { status: number }).status).toBe(400);
      expect(
        JSON.stringify(
          (error as InternalServerErrorException).getResponse(),
        ).includes('synthetic-do-not-echo'),
      ).toBe(false);
    }
    await expect(
      pipe.transform({}, { type: 'body', metatype: AdminPasswordResetBodyDto }),
    ).resolves.toBeInstanceOf(AdminPasswordResetBodyDto);
  });
});
