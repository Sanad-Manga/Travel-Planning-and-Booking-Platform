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
  /** ITN-18: FXRatesAPI has a usable free tier, so this is optional — no fail-fast check below. */
  FX_API_KEY?: string;
  /**
   * PAY-01: required for real payments, but validated lazily inside the Stripe gateway itself
   * (not here) — like FX_API_KEY, so building AppModule in isolation (most e2e specs do) never
   * needs a real key. A payment attempt without one fails clearly at that point instead.
   */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * GEN-01-B: like STRIPE_SECRET_KEY, validated lazily inside SmtpEmailSender, not here. Left
   * unset entirely in development — the sender then falls back to a throwaway Ethereal test inbox.
   */
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  /** ACC-02 (G12): dev/demo only, optional and not validated at boot. Only the exact value "true" auto-verifies new accounts. */
  AUTO_VERIFY_EMAIL?: string;
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
