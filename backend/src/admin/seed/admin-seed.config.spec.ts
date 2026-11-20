import { adminSeedFailureMessage, runAdminSeed } from './seed-admin';
import {
  AdminSeedConfigurationError,
  readAdminSeedConfig,
  readAdminSeedDatabaseUri,
} from './admin-seed.config';

jest.mock('dotenv', () => ({
  ...jest.requireActual<typeof import('dotenv')>('dotenv'),
  config: jest.fn(() => ({ parsed: {} })),
}));

const valid = {
  ADMIN_SEED_NAME: 'Fixture Administrator',
  ADMIN_SEED_EMAIL: 'admin@example.test',
  ADMIN_SEED_PASSWORD: 'TestAdmin9Password!',
};

describe('administrator environment validation', () => {
  it('normalizes name/email like registration and preserves password whitespace', () => {
    expect(
      readAdminSeedConfig({
        ...valid,
        ADMIN_SEED_NAME: '  Fixture Administrator  ',
        ADMIN_SEED_EMAIL: ' ADMIN@Example.Test ',
        ADMIN_SEED_PASSWORD: ' TestAdmin9Password! ',
      }),
    ).toEqual({
      name: valid.ADMIN_SEED_NAME,
      email: valid.ADMIN_SEED_EMAIL,
      password: ' TestAdmin9Password! ',
    });
  });

  it.each([
    'ADMIN_SEED_NAME',
    'ADMIN_SEED_EMAIL',
    'ADMIN_SEED_PASSWORD',
  ] as const)('requires %s without a fallback', (field) => {
    for (const value of [undefined, '', '   ', 42]) {
      expect(() => readAdminSeedConfig({ ...valid, [field]: value })).toThrow(
        AdminSeedConfigurationError,
      );
    }
  });

  it.each([
    ['invalid email', { ADMIN_SEED_EMAIL: 'not-an-email' }],
    ['long email', { ADMIN_SEED_EMAIL: `${'a'.repeat(255)}@example.test` }],
    ['long name', { ADMIN_SEED_NAME: 'a'.repeat(101) }],
    ['short password', { ADMIN_SEED_PASSWORD: 'Abc123' }],
    ['no digit', { ADMIN_SEED_PASSWORD: 'OnlyLettersHere' }],
    ['no letter', { ADMIN_SEED_PASSWORD: '123456789' }],
    [
      'ASCII password over byte limit',
      { ADMIN_SEED_PASSWORD: `A1${'x'.repeat(71)}` },
    ],
    [
      'Unicode password over byte limit',
      { ADMIN_SEED_PASSWORD: `${'ع'.repeat(36)}A1` },
    ],
  ])('rejects %s using the existing credential policy', (_label, change) => {
    expect(() => readAdminSeedConfig({ ...valid, ...change })).toThrow(
      AdminSeedConfigurationError,
    );
  });

  it('accepts exact ASCII and Unicode 72-byte boundaries from the auth policy', () => {
    for (const password of [`A1${'x'.repeat(70)}`, `${'ع'.repeat(35)}A1`]) {
      expect(
        readAdminSeedConfig({ ...valid, ADMIN_SEED_PASSWORD: password })
          .password,
      ).toBe(password);
    }
  });

  it('requires an explicit MongoDB URI without including it in validation errors', () => {
    expect(
      readAdminSeedDatabaseUri({
        MONGODB_URI: ' mongodb://127.0.0.1:27017/disposable ',
      }),
    ).toBe('mongodb://127.0.0.1:27017/disposable');
    for (const uri of [
      undefined,
      '',
      '<placeholder>',
      'https://private-user:private-password@example.test',
    ]) {
      expect(() => readAdminSeedDatabaseUri({ MONGODB_URI: uri })).toThrow(
        AdminSeedConfigurationError,
      );
      try {
        readAdminSeedDatabaseUri({ MONGODB_URI: uri });
      } catch (error) {
        expect(adminSeedFailureMessage(error)).not.toMatch(
          /private-user|private-password|example\.test/,
        );
      }
    }
  });

  it('fails configuration before any database connection is attempted', async () => {
    await expect(
      runAdminSeed({
        ...valid,
        ADMIN_SEED_PASSWORD: '',
        MONGODB_URI: 'mongodb://127.0.0.1:1/unreachable',
      }),
    ).rejects.toBeInstanceOf(AdminSeedConfigurationError);
    await expect(runAdminSeed(valid)).rejects.toBeInstanceOf(
      AdminSeedConfigurationError,
    );
  });

  it('never reports credential values, raw driver errors or stacks', () => {
    expect(
      adminSeedFailureMessage(
        new Error(
          'mongodb://private-user:private-password@example.test passwordHash=secret',
        ),
      ),
    ).toBe(
      'Administrator seed failed: database operation failed. Check configuration, indexes and database permissions.',
    );
    try {
      readAdminSeedConfig({ ...valid, ADMIN_SEED_PASSWORD: 'sensitive-value' });
    } catch (error) {
      expect(adminSeedFailureMessage(error)).toContain('ADMIN_SEED_PASSWORD');
      expect(adminSeedFailureMessage(error)).not.toContain('sensitive-value');
    }
  });
});
