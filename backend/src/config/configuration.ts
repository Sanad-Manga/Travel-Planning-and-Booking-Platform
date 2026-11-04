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
    cookieSecure: String(env.COOKIE_SECURE ?? String(process.env.NODE_ENV === 'production')) === 'true',
  };
};
