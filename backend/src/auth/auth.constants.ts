/** bcrypt only uses the first 72 BYTES of its input (not characters); the rest would be silently ignored. */
export const PASSWORD_MAX_BYTES = 72;

/** ACC-07: how long a forgotten-password link works. */
export const RESET_TOKEN_TTL_MINUTES = 30;
/** A genuine token (32 random bytes as base64url) is 43 characters long. */
export const RESET_TOKEN_MAX_LENGTH = 200;
/** ONE message for an unknown, expired, used or replaced token, so the reason is never revealed. */
export const RESET_TOKEN_ERROR_MESSAGE = 'token is invalid or has expired';
/** The same body for every forgot-password call, whatever the email. */
export const FORGOT_PASSWORD_RESPONSE_MESSAGE = 'If the email is registered, a reset link has been sent.';

/** ACC-07 review: a second forgot-password for the same account inside this window creates no token and sends no email. */
export const RESET_REQUEST_COOLDOWN_SECONDS = 60;
