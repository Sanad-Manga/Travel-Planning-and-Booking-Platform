import { ConfigService } from '@nestjs/config';

export const JWT_SECRET_MIN_LENGTH = 32;

export interface JwtSecrets {
  access: string;
  refresh: string;
}

/**
 * Reads and validates the JWT secrets. Called while the app boots (inside the JwtModule factory),
 * so a missing or weak secret stops the start-up with a clear message instead of failing at the first login.
 */
export function readJwtSecrets(config: ConfigService): JwtSecrets {
  const access = String(config.get('JWT_ACCESS_SECRET') ?? '').trim();
  const refresh = String(config.get('JWT_REFRESH_SECRET') ?? '').trim();

  const errors: string[] = [];
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', access],
    ['JWT_REFRESH_SECRET', refresh],
  ]) {
    if (!value || value.startsWith('<')) {
      errors.push(`${name} is required (set it in backend/.env)`);
    } else if (value.length < JWT_SECRET_MIN_LENGTH) {
      errors.push(`${name} must be at least ${JWT_SECRET_MIN_LENGTH} characters long`);
    }
  }
  // With equal secrets an access token would also verify as a refresh token (and the other way round).
  if (errors.length === 0 && access === refresh) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (errors.length) {
    throw new Error(`Invalid auth configuration:\n - ${errors.join('\n - ')}`);
  }
  return { access, refresh };
}
