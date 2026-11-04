/** bcrypt only uses the first 72 BYTES of its input (not characters); the rest would be silently ignored. */
export const PASSWORD_MAX_BYTES = 72;
