/**
 * The one place that defines what a phone number is (ACC-09).
 * Spaces, dashes, dots and parentheses are typing aids and are stripped, so "+20 100-123-4567" is stored as "+201001234567".
 * What is left must be an optional leading "+" and 7 to 15 digits (the E.164 maximum). No country check is done.
 * An empty string is allowed and means "remove my phone number".
 */
export const PHONE_PATTERN = /^(\+?\d{7,15})?$/;

export function normalizePhone(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/[\s\-().]/g, '') : value;
}
