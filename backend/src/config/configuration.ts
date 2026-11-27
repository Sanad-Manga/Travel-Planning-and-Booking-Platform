import { EnvVars } from './env.validation';

/**
 * Typed config, read with `configService.get('mongodbUri', { infer: true })`.
 * Receives the already-validated env (see env.validation.ts).
 */
export default () => {
  const env = process.env as unknown as Partial<EnvVars>;
  return {
    port: Number(env.PORT ?? 3001),
    frontendUrl: env.FRONTEND_URL ?? 'http://localhost:3000',
    mongodbUri: env.MONGODB_URI as string,
    // ACC-02: base URL of this API, used in the email-verification link. Optional (like SMTP), not validated at boot.
    // ACC-02 (G12): dev/demo only. Exactly "true" turns it on; unset or anything else is off.
    autoVerifyEmail: env.AUTO_VERIFY_EMAIL === 'true',
    cookieSecure: String(env.COOKIE_SECURE ?? String(process.env.NODE_ENV === 'production')) === 'true',
  };
};
