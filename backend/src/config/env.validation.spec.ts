import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const ok = { MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.mongodb.net/db' };

  it('accepts a valid env and fills in defaults', () => {
    const env = validateEnv(ok);
    expect(env.PORT).toBe(3001);
    expect(env.HOLD_MINUTES).toBe(10);
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.PLATFORM_CURRENCY).toBe('USD');
  });

  it('defaults COOKIE_SECURE to true in production and lets it be switched off explicitly', () => {
    expect(validateEnv({ ...ok, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
    expect(validateEnv({ ...ok, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(validateEnv({ ...ok, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false);
  });

  it('fails fast when MONGODB_URI is missing', () => {
    expect(() => validateEnv({})).toThrow(/MONGODB_URI is required/);
  });

  it('rejects the unedited placeholder from .env.example', () => {
    expect(() => validateEnv({ MONGODB_URI: '<team-mongodb-atlas-connection-string>' })).toThrow(/MONGODB_URI/);
  });

  it('rejects a non-mongodb URI, a bad port and a non-positive hold time', () => {
    expect(() => validateEnv({ MONGODB_URI: 'http://x' })).toThrow(/mongodb/);
    expect(() => validateEnv({ ...ok, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...ok, HOLD_MINUTES: '0' })).toThrow(/HOLD_MINUTES/);
  });
});
