import { registerDecorator, ValidationOptions } from 'class-validator';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as `YYYY-MM-DD` ("2026-02-30" and "2026-13-01" are false). */
export function isDateOnly(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date rolls an impossible day over to the next month, so any change on the round trip means invalid.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** class-validator decorator: the property must be a real `YYYY-MM-DD` date (contracts section 4, date-only fields). */
export function IsDateOnly(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isDateOnly',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a valid date in YYYY-MM-DD format`, ...options },
      validator: { validate: (value: unknown) => isDateOnly(value) },
    });
  };
}
