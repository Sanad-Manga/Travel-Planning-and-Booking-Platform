/**
 * Validates environment variables at startup so the app fails fast with a clear message.
 * Only variables the skeleton itself needs are required. Each feature owner validates its own
 * (JWT secrets, Stripe keys, FX key) when they wire that feature in.
 */
export interface EnvVars {
  PORT: number;
  FRONTEND_URL: string;
  MONGODB_URI: string;
  COOKIE_SECURE: boolean;
  HOLD_MINUTES: number;
  PLATFORM_CURRENCY: string;
}

export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> & EnvVars {
  const errors: string[] = [];

  const mongodbUri = String(raw.MONGODB_URI ?? '').trim();
  if (!mongodbUri || mongodbUri.startsWith('<')) {
    errors.push('MONGODB_URI is required (copy .env.example to backend/.env and set the team connection string)');
  } else if (!/^mongodb(\+srv)?:\/\//.test(mongodbUri)) {
    errors.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }

  const port = Number(raw.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be a valid port number');

  const holdMinutes = Number(raw.HOLD_MINUTES ?? 10);
  if (!Number.isFinite(holdMinutes) || holdMinutes <= 0) errors.push('HOLD_MINUTES must be a positive number');

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }

  return {
    ...raw,
    PORT: port,
    FRONTEND_URL: String(raw.FRONTEND_URL ?? 'http://localhost:3000'),
    MONGODB_URI: mongodbUri,
    // Secure cookies are the default in production (PDF 8.1); local http dev opts out with COOKIE_SECURE=false.
    COOKIE_SECURE: String(raw.COOKIE_SECURE ?? String(raw.NODE_ENV === 'production')) === 'true',
    HOLD_MINUTES: holdMinutes,
    PLATFORM_CURRENCY: String(raw.PLATFORM_CURRENCY ?? 'USD'),
  };
}
