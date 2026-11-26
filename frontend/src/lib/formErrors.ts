import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/**
 * GEN-02: show the backend's field-level validation errors (`details: [{ field, message }]`) next to the
 * right inputs of a react-hook-form form. Returns the errors that did not match any field, plus the
 * message, so the form can show them in an Alert:
 *
 *   try { await createThing(values); }
 *   catch (error) { const rest = applyApiErrors(error, setError, ['name', 'email']); if (rest) setBanner(rest); }
 *
 * `fields` lists the form's own field names; a detail for a field the form does not have is returned
 * instead of being lost. Nested names such as `passengers.0.name` are passed through as they are.
 */
export function applyApiErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): string | null {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  const unmatched: string[] = [];
  for (const detail of error.details) {
    if (fields.includes(detail.field) || fields.some((name) => detail.field.startsWith(`${name}.`))) {
      setError(detail.field as Path<T>, { type: 'server', message: detail.message });
    } else {
      unmatched.push(detail.message);
    }
  }
  if (error.details.length === 0) return error.message;
  return unmatched.length > 0 ? unmatched.join(' ') : null;
}
