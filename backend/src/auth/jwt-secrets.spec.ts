import { ConfigService } from '@nestjs/config';
import { readJwtSecrets } from './jwt-secrets';

// Fake values only.
const GOOD = 'x'.repeat(32);
const config = (values: Record<string, string>) => new ConfigService(values);

describe('readJwtSecrets', () => {
  it('returns both secrets when they are long enough', () => {
    expect(readJwtSecrets(config({ JWT_ACCESS_SECRET: GOOD, JWT_REFRESH_SECRET: GOOD + 'y' }))).toEqual({
      access: GOOD,
      refresh: GOOD + 'y',
    });
  });

  it('fails fast with a clear message when a secret is missing', () => {
    expect(() => readJwtSecrets(config({ JWT_ACCESS_SECRET: GOOD }))).toThrow('JWT_REFRESH_SECRET is required');
  });

  it('fails when both secrets are equal', () => {
    expect(() => readJwtSecrets(config({ JWT_ACCESS_SECRET: GOOD, JWT_REFRESH_SECRET: GOOD }))).toThrow(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    );
  });

  it('fails when a secret is shorter than 32 characters or still the .env.example placeholder', () => {
    expect(() => readJwtSecrets(config({ JWT_ACCESS_SECRET: 'short', JWT_REFRESH_SECRET: GOOD }))).toThrow(
      'JWT_ACCESS_SECRET must be at least 32 characters',
    );
    expect(() => readJwtSecrets(config({ JWT_ACCESS_SECRET: '<change-me>', JWT_REFRESH_SECRET: GOOD }))).toThrow(
      'JWT_ACCESS_SECRET is required',
    );
  });
});
